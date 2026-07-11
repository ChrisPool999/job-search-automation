import "dotenv/config"
import fs from 'fs';
import path from 'path';
// import { firefox } from 'playwright';
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import { getDirectorDecision } from './vision-director.js';
import { navigateToTarget } from './navigation-agent.js';
import { createStatusLogger } from './status-logger.js';
import { createCliDashboard } from './cli-dashboard.js';

const DEFAULT_JOB_URLS = [
    'https://edel.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_2001/job/22744',
    'https://jobs.northropgrumman.com/careers/job/1340071751736?code=JB-18020&domain=ngc.com&rx_a=1&rx_c=engineering&rx_ch=jobp4p&rx_group=543974&rx_id=9b3542a3-5123-11f1-b7c0-b77d8310ea10&rx_job=R10233177&rx_medium=cpc&rx_r=none&rx_source=Indeed&rx_ts=20260706T202526Z&rx_vp=cpc&source=JB-18020&utm_audience=prospectivetalentemployees&utm_campaign=ta-general&utm_content=jobfeed&utm_format=cpl&utm_medium=jobboard&utm_source=indeed',
    'https://www.amazon.jobs/en/jobs/10423349/embedded-software-engineer-ii-connectivity-systems-at-eero?cmpid=DA_INAD200785B',
    'https://ibegin.tcsapps.com/candidate/jobs/413770J',
    'https://jobs.siemens.com/en_US/externaljobs/JobDetail/507945?source=Indeed&source=Indeed'
];
const VIEWPORT = { width: 2560, height: 1080 };

const RUN_CONFIG = {
    runFolder: path.join('vision-debug', 'latest-run'),
    maxSteps: 25,
    postClickDelayMs: 3000,
    pageReadyDelayMs: 2000,
    directorRetryAttempts: 3,
    directorRetryDelayMs: 2000,
    keepBrowserOpenForManualReview: process.env.VISION_KEEP_BROWSER_OPEN === '1',
};

function normalizeEnvValue(value) {
    return String(value ?? '')
        .trim()
        .replace(/^['"]+/, '')
        .replace(/['"]+$/, '')
        .replace(/,$/, '')
        .trim();
}

function getEnvValue(name) {
    return normalizeEnvValue(process.env[name] || '');
}

const ENV_CREDENTIALS = {
    email: getEnvValue('EMAIL'),
    password: getEnvValue('PASSWORD'),
};

const HAS_ENV_CREDENTIALS = Boolean(ENV_CREDENTIALS.email && ENV_CREDENTIALS.password);

function getConfiguredApiKeys() {
    const requestedSize = Number(normalizeEnvValue(process.env.API_KEY_SIZE || 1));
    if (!Number.isInteger(requestedSize) || requestedSize < 1) {
        throw new Error(`Invalid API_KEY_SIZE: ${process.env.API_KEY_SIZE}`);
    }

    const keys = [];
    for (let i = 1; i <= requestedSize; i++) {
        const key = normalizeEnvValue(process.env[`GEMINI_API_KEY${i}`]);
        if (!key) {
            throw new Error(`Missing GEMINI_API_KEY${i} for configured API_KEY_SIZE=${requestedSize}`);
        }
        keys.push(key);
    }

    return keys;
}

function getConfiguredUrls() {
    const apiKeys = getConfiguredApiKeys();
    if (DEFAULT_JOB_URLS.length !== apiKeys.length) {
        throw new Error(`Expected ${apiKeys.length} job URLs to match API_KEY_SIZE=${apiKeys.length}, but found ${DEFAULT_JOB_URLS.length}`);
    }
    return DEFAULT_JOB_URLS.slice(0, apiKeys.length);
}

const logger = createStatusLogger({ logDir: RUN_CONFIG.runFolder, runLabel: 'vision-controller', consoleOutput: false });
const dashboard = createCliDashboard({ getSessions: () => sessionsState });

const DEBUG_DIR = RUN_CONFIG.runFolder;
const ACTION_LOG_PATH = path.join(DEBUG_DIR, 'actions.json');
let debugActions = [];
let sessionsState = [];

function isInvalidApiKeyError(err) {
    const message = String(err?.message || err?.status || '');
    return message.includes('API key not valid') || message.includes('INVALID_ARGUMENT') || message.includes('API_KEY_INVALID');
}

function appendUiAction(session, message) {
    session.ui.events = [
        ...(session.ui.events || []),
        { timestamp: new Date().toISOString(), message },
    ].slice(-20);
}

function shortText(text, maxLength = 18) {
    if (!text) return 'unknown';
    const cleaned = String(text).replace(/\s+/g, ' ').trim();
    return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, maxLength - 1)}…`;
}

function getShortTaskName(entry) {
    if (!entry) return 'unknown task';
    const target = shortText(entry.targetText || entry.description || 'unknown');
    switch (entry.targetType) {
        case 'input': return `type ${target}`;
        case 'button': return `click ${target}`;
        case 'link': return `click ${target}`;
        case 'done': return 'finish';
        default: return target;
    }
}

function buildRecentTaskHistory(history) {
    const recent = history.slice(-10);
    if (!recent.length) {
        return 'No previous tasks.';
    }
    return recent.map((entry, index) => {
        const task = getShortTaskName(entry);
        const result = entry.result ? ` => ${shortText(entry.result, 24)}` : '';
        const navLabel = entry.navAction ? ` [nav:${shortText(entry.navAction, 24)}]` : '';
        return `${index + 1}. ${task}${result}${navLabel}`;
    }).join('\n');
}

async function prepareDebugDir() {
    if (fs.existsSync(DEBUG_DIR)) {
        await fs.promises.rm(DEBUG_DIR, { recursive: true, force: true });
    }
    await fs.promises.mkdir(DEBUG_DIR, { recursive: true });
    debugActions = [];
    await fs.promises.writeFile(ACTION_LOG_PATH, JSON.stringify(debugActions, null, 2));
}

async function ensurePageReady(page) {
    try { await page.bringToFront(); } catch {}
    try {
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    } catch {
        logger.warn('page ready timeout; continuing anyway');
    }
    await page.waitForTimeout(RUN_CONFIG.pageReadyDelayMs);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function getDirectorDecisionWithRetry(page, history, apiKey = null, operatorInstruction = null) {
    let lastDecision = null;

    for (let attempt = 1; attempt <= RUN_CONFIG.directorRetryAttempts; attempt++) {
        const decision = await getDirectorDecision(page, history, apiKey, operatorInstruction);
        lastDecision = decision;

        const description = `${decision.description || ''} ${decision.pageState || ''}`.toLowerCase();
        const appearsToBeLoading = description.includes('loading') || description.includes('spinner') || description.includes('loading state');

        if (!appearsToBeLoading) {
            return decision;
        }

        if (attempt < RUN_CONFIG.directorRetryAttempts) {
            logger.warn('director saw loading state; retrying after delay', {
                attempt,
                description: decision.description,
            });
            await page.waitForTimeout(RUN_CONFIG.directorRetryDelayMs);
        }
    }

    return lastDecision;
}

async function saveStepScreenshot(page, step, label) {
    const stepNum = String(step).padStart(2, '0');
    const filename = path.join(DEBUG_DIR, `${stepNum}-${label}.png`);
    await page.screenshot({ path: filename, fullPage: false });
    return filename;
}

async function logAction(step, decision, navResult, tabLabel = 'tab-1') {
    debugActions.push({
        step,
        tabLabel,
        targetText: decision.targetText,
        pageState: decision.pageState,
        confidence: decision.confidence,
        description: decision.description,
        navSuccess: navResult?.success ?? null,
        tabsTaken: navResult?.tabs ?? null,
        matchedText: navResult?.matchedText ?? null,
        navThought: navResult?.thought ?? null,
        timestamp: new Date().toISOString(),
    });
    await fs.promises.writeFile(ACTION_LOG_PATH, JSON.stringify(debugActions, null, 2));
}

async function createTabSession(context, tabIndex, url, apiKey) {
    const page = await context.newPage();
    const label = `tab-${tabIndex + 1}`;
    await page.setViewportSize(VIEWPORT);
    await page.bringToFront();
    logger.info('created browser tab', { label, url, apiKeyPrefix: apiKey.slice(0, 8) });
    return {
        label,
        page,
        url,
        apiKey,
        history: [],
        steps: 0,
        ui: {
            status: 'starting',
            summary: 'initializing',
            attention: false,
            paused: false,
            pendingInstruction: null,
            killed: false,
            resolved: false,
            currentThought: null,
            visionThought: null,
            navThought: null,
            agentName: null,
            completedLabel: null,
            events: [],
        },
    };
}

async function waitForOperator(session) {
    while (session?.ui?.attention && !session?.ui?.killed) {
        session.ui.status = 'waiting';
        session.ui.summary = session.ui.pendingInstruction ? `awaiting operator: ${session.ui.pendingInstruction}` : 'waiting for operator';
        session.ui.events = [
            ...(session.ui.events || []),
            { timestamp: new Date().toISOString(), message: 'waiting for operator instruction' },
        ].slice(-20);
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
}

async function runTabSession(session) {
    let steps = 0;

    session.ui.status = 'working';
    session.ui.summary = 'starting automation';
    session.ui.currentThought = 'Beginning automation and analyzing the first page.';
    appendUiAction(session, 'Automation started');

    while (steps < RUN_CONFIG.maxSteps) {
        if (session.ui.killed || session.ui.status === 'done' || session.ui.resolved) {
            break;
        }

        if (session.ui.paused) {
            session.ui.status = 'paused';
            session.ui.summary = 'paused by operator';
            await new Promise((resolve) => setTimeout(resolve, 500));
            continue;
        }

        if (session.ui.attention) {
            await waitForOperator(session);
            if (session.ui.killed) {
                break;
            }
            session.ui.attention = false;
            session.ui.status = 'working';
            session.ui.summary = session.ui.pendingInstruction ? `resumed with: ${session.ui.pendingInstruction}` : 'resumed by operator';
            session.ui.events = [
                ...(session.ui.events || []),
                { timestamp: new Date().toISOString(), message: 'resumed by operator' },
            ].slice(-20);
        }

        const currentStep = steps + 1;
        session.ui.status = 'working';
        session.ui.summary = `step ${currentStep}/${RUN_CONFIG.maxSteps} in progress`;
        session.ui.events = [...(session.ui.events || []), { timestamp: new Date().toISOString(), message: `step ${currentStep}/${RUN_CONFIG.maxSteps} started` }].slice(-20);
        logger.info(`step ${currentStep}/${RUN_CONFIG.maxSteps} starting`, { tab: session.label, url: session.page.url() });

        logger.info('director analyzing page', { tab: session.label });

        const operatorInstruction = session.ui.pendingInstruction || null;
        if (operatorInstruction) {
            session.ui.pendingInstruction = null;
        }

        let decision;
        try {
            decision = await getDirectorDecisionWithRetry(session.page, session.history.slice(-5), session.apiKey, operatorInstruction);
        } catch (err) {
            if (isInvalidApiKeyError(err)) {
                session.ui.status = 'waiting';
                session.ui.summary = 'invalid API key';
                session.ui.attention = true;
                session.ui.events = [...(session.ui.events || []), { timestamp: new Date().toISOString(), message: 'invalid API key encountered' }].slice(-20);
                logger.error('tab stopped due to invalid API key', { tab: session.label, message: err.message });
                break;
            }

            session.ui.status = 'waiting';
            session.ui.summary = 'director error';
            session.ui.attention = true;
            session.ui.events = [...(session.ui.events || []), { timestamp: new Date().toISOString(), message: `director error: ${err.message}` }].slice(-20);
            logger.error('tab stopped due to director error', { tab: session.label, message: err.message });
            break;
        }

        logger.info('director decision ready', {
            tab: session.label,
            targetText: decision.targetText,
            targetType: decision.targetType,
            pageState: decision.pageState,
            confidence: decision.confidence,
            description: decision.description,
        });

        session.ui.visionThought = decision.description || `Director selected ${decision.targetText}`;
        session.ui.currentThought = session.ui.visionThought;
        appendUiAction(session, `Director thought: ${session.ui.visionThought}`);
        await saveStepScreenshot(session.page, currentStep, `${session.label}-director`);

        if (decision.targetType === 'done' || decision.pageState === 'summary') {
            const finalName = decision.finalName?.trim();
            if (finalName) {
                session.ui.agentName = finalName;
                session.ui.completedLabel = finalName;
            } else if (decision.jobUnavailable) {
                session.ui.agentName = 'job unavailable';
                session.ui.completedLabel = 'job unavailable';
            } else {
                session.ui.completedLabel = 'completed successfully';
            }
            session.ui.status = 'done';
            session.ui.resolved = true;
            session.ui.summary = session.ui.completedLabel;
            session.ui.events = [...(session.ui.events || []), { timestamp: new Date().toISOString(), message: `director completed: ${session.ui.completedLabel}` }].slice(-20);
            logger.info('director requested completion', { tab: session.label, finalName, jobUnavailable: decision.jobUnavailable });
            await logAction(currentStep, decision, null, session.label);
            break;
        }

        if (decision.isCycle) {
            session.ui.status = 'waiting';
            session.ui.summary = 'cycle detected; manual review needed';
            session.ui.attention = true;
            session.ui.events = [...(session.ui.events || []), { timestamp: new Date().toISOString(), message: 'cycle detected' }].slice(-20);
            logger.warn('cycle detected; flagging for manual review', { tab: session.label });
            await logAction(currentStep, decision, null, session.label);
            await waitForOperator(session);
            if (session.ui.killed || session.ui.status === 'done' || session.ui.resolved) {
                break;
            }
            continue;
        }

        if (!decision.targetText) {
            session.ui.status = 'waiting';
            session.ui.summary = 'no target identified; waiting';
            session.ui.events = [...(session.ui.events || []), { timestamp: new Date().toISOString(), message: 'no target identified' }].slice(-20);
            logger.warn('no target identified; skipping step', { tab: session.label });
            steps++;
            continue;
        }

        session.ui.status = 'navigating';
        session.ui.summary = `targeting ${decision.targetText}`;
        session.ui.navThought = `Sending target to nav agent for ${decision.targetText}`;
        session.ui.currentThought = `Vision: ${session.ui.visionThought}; Nav: ${session.ui.navThought}`;
        appendUiAction(session, session.ui.navThought);
        logger.info('navigation agent starting', { tab: session.label, targetText: decision.targetText, value: decision.value });
        const urlBefore = session.page.url();

        const navResult = await navigateToTarget(session.page, decision.targetText, decision.value, 50, logger, session.apiKey);

        await session.page.waitForTimeout(RUN_CONFIG.postClickDelayMs);
        await ensurePageReady(session.page);

        const urlAfter = session.page.url();
        const pageChanged = urlAfter !== urlBefore;
        const result = navResult.success
            ? pageChanged ? 'clicked — page navigated' : 'clicked — page unchanged'
            : 'target not found';

        session.ui.status = navResult.success ? 'working' : 'waiting';
        session.ui.summary = result;
        if (navResult.thought) {
            session.ui.navThought = navResult.thought;
            session.ui.currentThought = `Vision: ${session.ui.visionThought}; Nav: ${session.ui.navThought}`;
            appendUiAction(session, `Nav agent: ${navResult.thought}`);
        }
        appendUiAction(session, result);
        logger.info('navigation step completed', { tab: session.label, result, urlBefore, urlAfter });
        await saveStepScreenshot(session.page, currentStep, `${session.label}-after`);
        await logAction(currentStep, decision, { ...navResult, result }, session.label);

        session.history.push({
            step: currentStep,
            targetText: decision.targetText,
            targetType: decision.targetType,
            pageState: decision.pageState,
            result,
            confirmedValue: navResult?.confirmedValue ?? null,
            thought: session.ui.currentThought,
            navAction: navResult?.thought ?? null,
        });

        steps++;
    }

    if (steps >= RUN_CONFIG.maxSteps) {
        session.ui.status = 'waiting';
        session.ui.summary = 'reached max steps; manual review recommended';
        session.ui.attention = true;
        logger.warn('reached max steps; manual review recommended', { tab: session.label });
    }

    const finalPath = path.join(DEBUG_DIR, `${session.label}-final-state.png`);
    await session.page.screenshot({ path: finalPath });
    logger.info('captured final state screenshot', { tab: session.label, path: finalPath });
}

export async function runVisionLoop(url = DEFAULT_JOB_URLS[0], tabCount = null) {
    const apiKeys = getConfiguredApiKeys();
    const configuredUrls = getConfiguredUrls();
    const targetTabCount = tabCount ?? apiKeys.length;
    const urls = configuredUrls.slice(0, targetTabCount);
    logger.info('starting orchestrator', { url, tabCount: targetTabCount, apiKeys: apiKeys.length });

    const launchOptions = {
        headless: false,
        args: ['--start-maximized', `--window-size=${VIEWPORT.width},${VIEWPORT.height}`],
    };

    if (process.env.CHROME_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;
    }

    logger.info('launching visible browser', { headless: launchOptions.headless, keepBrowserOpen: RUN_CONFIG.keepBrowserOpenForManualReview });
    // Chromium currently handles the single-context, multi-tab flow more smoothly here.
    // If needed, revert to Firefox by replacing chromium.launch with firefox.launch.
    const browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({ viewport: VIEWPORT, screen: VIEWPORT });
    const sessions = [];

    try {
        await prepareDebugDir();
        logger.info('debug directory prepared', { runFolder: RUN_CONFIG.runFolder });

        for (let i = 0; i < targetTabCount; i++) {
            const session = await createTabSession(context, i, urls[i] || url, apiKeys[i]);
            sessions.push(session);
        }
        sessionsState = sessions;
        dashboard.start();

        await Promise.all(sessions.map(async (session) => {
            logger.info('opening page', { label: session.label, url: session.url });
            await session.page.goto(session.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await ensurePageReady(session.page);
        }));

        const activeSession = sessions[0];
        if (activeSession) {
            await activeSession.page.bringToFront();
        }

        await Promise.all(sessions.map((session) => runTabSession(session)));
    } catch (err) {
        logger.error('orchestrator failed', { message: err.message });
        throw err;
    } finally {
        dashboard.stop();
        if (RUN_CONFIG.keepBrowserOpenForManualReview) {
            logger.info('leaving browser open for manual review; press Ctrl+C to stop');
            await new Promise(() => {});
        } else {
            await browser.close();
        }
    }
}

async function main() {
    await runVisionLoop();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}