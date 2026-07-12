import "dotenv/config"
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import { getDirectorDecision } from './vision-director.js';
import { navigateToTarget } from './navigation-agent.js';
import { createStatusLogger } from './status-logger.js';
import { createCliDashboard } from './cli-dashboard.js';
import { shouldRequestSelfFix } from './self-fix-utils.js';

const DEFAULT_JOB_URLS = [
    // 'https://pcctalentacquisitionportal.tal.net/vx/lang-en-GB/mobile-0/appcentre-1/brand-7/xf-4529f9c669c1/candidate/so/pm/1/pl/3/opp/20465-NC-Programmer-II/en-GB',
    // 'https://jobs.northropgrumman.com/careers/job/1340071751736?code=JB-18020&domain=ngc.com&rx_a=1&rx_c=engineering&rx_ch=jobp4p&rx_group=543974&rx_id=9b3542a3-5123-11f1-b7c0-b77d8310ea10&rx_job=R10233177&rx_medium=cpc&rx_r=none&rx_source=Indeed&rx_ts=20260706T202526Z&rx_vp=cpc&source=JB-18020&utm_audience=prospectivetalentemployees&utm_campaign=ta-general&utm_content=jobfeed&utm_format=cpl&utm_medium=jobboard&utm_source=indeed',
    // 'https://www.amazon.jobs/en/jobs/10423349/embedded-software-engineer-ii-connectivity-systems-at-eero?cmpid=DA_INAD200785B',
    // 'https://ibegin.tcsapps.com/candidate/jobs/413770J',
    'https://jobs.siemens.com/en_US/externaljobs/JobDetail/507945?source=Indeed&source=Indeed',
    // 'https://www.governmentjobs.com/careers/solanocounty/jobs/5367966/information-technology-analyst-principal-unified-communications-engineer'
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
    const entry = { timestamp: new Date().toISOString(), message };
    session.ui.events = [
        ...(session.ui.events || []),
        entry,
    ].slice(-20);
    session.ui.controllerActions = [
        ...(session.ui.controllerActions || []),
        entry,
    ].slice(-100);
}

function maybeLogSanityCheck(session, decision, currentStep) {
    const recentHistory = session.history.slice(-4);
    if (!recentHistory.length) {
        return false;
    }

    const recentActions = (session.ui.controllerActions || []).slice(-8).map((entry) => entry.message || '');
    const repeatedTarget = recentHistory.filter((entry) => entry.targetText && entry.targetText === decision?.targetText).length >= 2;
    const repeatedUnchanged = recentHistory.filter((entry) => /unchanged|not found|failed|error/i.test(entry.result || '')).length >= 2;
    const samePageState = new Set(recentHistory.map((entry) => entry.pageState)).size <= 1;
    const resetSignal = recentActions.some((message) => /self-fix|recovery|reload|reset/i.test(message));
    const shouldCheck = currentStep % 4 === 0 || Boolean((repeatedTarget && repeatedUnchanged) || (samePageState && repeatedUnchanged) || resetSignal);

    if (shouldCheck) {
        appendUiAction(session, '[vision] sanity check');
    }
    return shouldCheck;
}

function flagSessionForOperatorReview(session, { summary, message, reason = null, blocked = false, attention = true, status = 'waiting' }) {
    session.ui.attention = Boolean(attention) && !blocked;
    session.ui.blocked = Boolean(blocked);
    session.ui.completedByOperator = false;
    session.ui.paused = false;
    session.ui.pendingInstruction = null;
    session.ui.status = blocked ? 'blocked' : status;
    session.ui.summary = summary;
    session.ui.reviewReason = reason;
    appendUiAction(session, message);
}

function resumeSession(session, summary = 'resumed by operator', message = 'resumed by operator') {
    session.ui.attention = false;
    session.ui.blocked = false;
    session.ui.completedByOperator = false;
    session.ui.paused = false;
    session.ui.pendingInstruction = null;
    session.ui.status = 'working';
    session.ui.summary = summary;
    appendUiAction(session, message);
}

function shortText(text, maxLength = 18) {
    if (!text) return 'unknown';
    const cleaned = String(text).replace(/\s+/g, ' ').trim();
    return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, maxLength - 1)}…`;
}

function normalizeVerificationText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

export function verifyNavAgentResult(session, decision, navResult) {
    const feedMessages = [...(session.ui?.navFeed || []), ...(navResult?.liveFeed || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    const explicitAction = ['click', 'enter', 'type', 'interact', 'toggle'].includes(navResult?.actionType);
    const sawActionInFeed = /clicked|pressed enter|typed|filled|populate|populated|interact|toggled|toggle|checkbox|input/i.test(feedMessages);
    const targetText = normalizeVerificationText(decision?.targetText);
    const requestedValue = normalizeVerificationText(decision?.value);
    const targetMentioned = targetText ? feedMessages.includes(targetText) : true;

    if (!navResult?.success && !explicitAction && !sawActionInFeed) {
        return { ok: false, reason: 'nav agent reported failure' };
    }

    if (decision?.targetType === 'input') {
        const actionLooksRight = /typed|input|filled|populate|populated|interact/i.test(feedMessages);
        const ok = actionLooksRight && (targetMentioned || requestedValue || /typed|filled|populated/i.test(feedMessages));
        return {
            ok,
            reason: ok
                ? 'nav feed shows an input-style action for the requested field'
                : 'nav feed did not clearly show the requested input action',
        };
    }

    const actionLooksRight = /clicked|pressed enter|enter|interact|toggled|toggle|checkbox/i.test(feedMessages);
    const ok = actionLooksRight && (targetMentioned || /control|button|element|checkbox|input/i.test(feedMessages));
    return {
        ok,
        reason: ok
            ? 'nav feed shows a click/enter-style action for the requested control'
            : 'nav feed did not clearly show the requested click/enter action',
    };
}

async function runFailureFallback(session, currentStep) {
    const fallbackLabel = 'reading failure fallback';
    session.ui.activeAgent = 'vision';
    session.ui.controllerThought = fallbackLabel;
    session.ui.currentThought = fallbackLabel;
    session.ui.navThought = null;
    session.ui.liveNavFocus = null;
    session.ui.status = 'working';
    session.ui.summary = fallbackLabel;
    appendUiAction(session, 'recovery mode');

    const recentHistory = session.history.slice(-6);
    const previousFailures = recentHistory.filter((entry) => entry.result && /not found|failed|error|unchanged/i.test(entry.result));

    const fallbackSteps = [
        {
            title: 'analyze recent nav history and tabs',
            run: async () => {
                appendUiAction(session, 'recovery mode');
            },
        },
        {
            title: 'retry the latest navigation action from the current state',
            run: async () => {
                const lastEntry = session.history.at(-1);
                if (!lastEntry?.targetText) {
                    appendUiAction(session, 'recovery mode');
                    return false;
                }

                const retryLabel = lastEntry.targetText;
                session.ui.navThought = `Retrying ${retryLabel}`;
                session.ui.currentThought = `${fallbackLabel}: retrying ${retryLabel}`;
                appendUiAction(session, 'recovery mode');

                const navResult = await navigateToTarget(session.page, lastEntry.targetText, lastEntry.inputValue || null, 50, logger, session.apiKey, (message) => {
                    session.ui.activeAgent = 'nav';
                    session.ui.liveNavFocus = message;
                    session.ui.navFeed = [...(session.ui.navFeed || []), message].slice(-12);
                    session.ui.controllerThought = `${fallbackLabel}: ${message}`;
                    session.ui.currentThought = session.ui.controllerThought;
                });

                await session.page.waitForTimeout(RUN_CONFIG.postClickDelayMs);
                await ensurePageReady(session.page);
                const retrySucceeded = Boolean(navResult?.success);
                appendUiAction(session, 'recovery mode');
                return retrySucceeded;
            },
        },
        {
            title: 'refresh and re-check the page for latency or stale state',
            run: async () => {
                appendUiAction(session, 'recovery mode');
                await session.page.waitForTimeout(1500);
                await session.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
                await ensurePageReady(session.page);
                await saveStepScreenshot(session.page, currentStep, `${session.label}-fallback`);
                appendUiAction(session, 'recovery mode');
                return true;
            },
        },
    ];

    let didSomethingUseful = false;
    for (const step of fallbackSteps) {
        const stepResult = await step.run();
        if (stepResult) {
            didSomethingUseful = true;
        }
    }

    session.ui.status = 'working';
    session.ui.summary = didSomethingUseful ? 'fallback completed; re-checking page' : 'fallback completed; awaiting operator help';
    return didSomethingUseful;
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
        const navParts = [];
        if (entry.navAction) navParts.push(shortText(entry.navAction, 24));
        if (entry.navMatched) navParts.push(`match:${shortText(entry.navMatched, 24)}`);
        const navLabel = navParts.length ? ` [nav:${navParts.join(',')}]` : '';
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

async function applySelfFix(session, decision, history, currentStep) {
    const reason = decision?.description || 'stalled page state';
    const selfFixCount = Number(session.ui?.selfFixCount || 0);
    if (!shouldRequestSelfFix(decision, history, selfFixCount)) {
        return false;
    }

    session.ui.selfFixCount = selfFixCount + 1;
    session.ui.activeAgent = 'vision';
    session.ui.controllerThought = `Self-fixing stalled state: ${reason}`;
    session.ui.currentThought = session.ui.controllerThought;
    session.ui.navThought = null;
    session.ui.liveNavFocus = null;
    session.ui.status = 'working';
    session.ui.summary = 'self-fixing stalled state';
    appendUiAction(session, `Self-fix: waiting and re-checking page state`);

    try {
        await session.page.waitForTimeout(2500);
        await session.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
        await ensurePageReady(session.page);
        await saveStepScreenshot(session.page, currentStep, `${session.label}-selffix`);
        logger.info('applied self-fix wait/reload', { tab: session.label, step: currentStep, reason });
        return true;
    } catch (error) {
        logger.warn('self-fix wait/reload failed', { tab: session.label, error: error.message });
        return false;
    }
}

async function getDirectorDecisionWithRetry(page, history, tabLabel = 'tab-1', apiKey = null, operatorInstruction = null) {
    let lastDecision = null;

    for (let attempt = 1; attempt <= RUN_CONFIG.directorRetryAttempts; attempt++) {
        const decision = await getDirectorDecision(page, history, tabLabel, apiKey, operatorInstruction);
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
        navActionType: navResult?.actionType ?? null,
        focusedElement: navResult?.focused ?? null,
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
            blocked: false,
            completedByOperator: false,
            reviewReason: null,
            selfFixCount: 0,
            currentThought: null,
            controllerThought: null,
            visionThought: null,
            navThought: null,
            activeAgent: 'vision',
            liveNavFocus: null,
            navFeed: [],
            navTrace: [],
            agentName: null,
            completedLabel: null,
            events: [],
            controllerActions: [],
            navTabAccumulator: 0,
        },
    };
}

async function waitForOperator(session) {
    while (!session?.ui?.killed && (session?.ui?.attention || session?.ui?.blocked || session?.ui?.completedByOperator)) {
        if (session.ui.blocked) {
            session.ui.status = 'blocked';
            session.ui.summary = 'blocked by operator';
        } else if (session.ui.completedByOperator) {
            session.ui.status = 'done';
            session.ui.summary = 'marked done by operator';
        } else {
            session.ui.status = 'waiting';
            session.ui.summary = session.ui.pendingInstruction ? `awaiting operator: ${session.ui.pendingInstruction}` : 'waiting for operator';
        }
        session.ui.events = [
            ...(session.ui.events || []),
            { timestamp: new Date().toISOString(), message: 'waiting for operator action' },
        ].slice(-20);
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
}

async function runTabSession(session) {
    let steps = 0;

    session.ui.status = 'working';
    session.ui.summary = 'starting automation';
    session.ui.activeAgent = 'vision';
    session.ui.controllerThought = 'Beginning automation and analyzing the first page.';
    session.ui.currentThought = session.ui.controllerThought;
    appendUiAction(session, 'Automation started');

    while (steps < RUN_CONFIG.maxSteps) {
        if (session.ui.killed) {
            break;
        }

        if (session.ui.completedByOperator || session.ui.blocked) {
            await waitForOperator(session);
            if (session.ui.killed) {
                break;
            }
            continue;
        }

        if (session.ui.paused) {
            session.ui.status = 'paused';
            session.ui.summary = 'paused by operator';
            await new Promise((resolve) => setTimeout(resolve, 500));
            continue;
        }

        const currentStep = steps + 1;

        if (session.ui.attention) {
            const fallbackUsed = await runFailureFallback(session, currentStep);
            if (session.ui.killed) {
                break;
            }
            if (fallbackUsed) {
                session.ui.attention = false;
                session.ui.status = 'working';
                session.ui.summary = 'fallback completed; resuming automation';
                appendUiAction(session, 'Fallback completed; resuming automation');
                continue;
            }
            await waitForOperator(session);
            if (session.ui.killed) {
                break;
            }
            resumeSession(
                session,
                session.ui.pendingInstruction ? `resumed with: ${session.ui.pendingInstruction}` : 'resumed by operator',
                'resumed by operator',
            );
        }
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
            decision = await getDirectorDecisionWithRetry(session.page, session.history.slice(-10), session.label, session.apiKey, operatorInstruction);
        } catch (err) {
            if (isInvalidApiKeyError(err)) {
                flagSessionForOperatorReview(session, {
                    summary: 'invalid API key',
                    message: 'invalid API key encountered',
                    reason: 'invalid API key',
                    attention: true,
                    status: 'waiting',
                });
                logger.error('tab paused for operator review due to invalid API key', { tab: session.label, message: err.message });
                await waitForOperator(session);
                if (session.ui.killed) {
                    break;
                }
                continue;
            }

            flagSessionForOperatorReview(session, {
                summary: 'director error',
                message: `director error: ${err.message}`,
                reason: 'director error',
                attention: true,
                status: 'waiting',
            });
            logger.error('tab paused for operator review due to director error', { tab: session.label, message: err.message });
            await waitForOperator(session);
            if (session.ui.killed) {
                break;
            }
            continue;
        }

        logger.info('director decision ready', {
            tab: session.label,
            targetText: decision.targetText,
            targetType: decision.targetType,
            pageState: decision.pageState,
            confidence: decision.confidence,
            description: decision.description,
        });

        session.ui.activeAgent = 'vision';
        session.ui.visionThought = decision.description || `Director selected ${decision.targetText}`;
        session.ui.controllerThought = session.ui.visionThought;
        session.ui.currentThought = session.ui.controllerThought;
        maybeLogSanityCheck(session, decision, currentStep);
        appendUiAction(session, 'vision controller viewing screenshot');
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
            flagSessionForOperatorReview(session, {
                summary: 'director reached a completion-like state; awaiting operator review',
                message: `director reached a completion-like state: ${session.ui.completedLabel}`,
                reason: 'completion-like state',
                blocked: Boolean(decision.jobUnavailable || decision.pageState === 'job_unavailable'),
            });
            logger.info('director requested review instead of auto-completion', { tab: session.label, finalName, jobUnavailable: decision.jobUnavailable });
            await logAction(currentStep, decision, null, session.label);
            continue;
        }

        if (decision.isCycle) {
            flagSessionForOperatorReview(session, {
                summary: 'cycle detected; manual review needed',
                message: 'cycle detected',
                reason: 'cycle detected',
            });
            logger.warn('cycle detected; flagging for manual review', { tab: session.label });
            await logAction(currentStep, decision, null, session.label);
            await waitForOperator(session);
            if (session.ui.killed) {
                break;
            }
            continue;
        }

        if (!decision.targetText) {
            flagSessionForOperatorReview(session, {
                summary: 'no target identified; awaiting operator review',
                message: 'no target identified',
                reason: 'no target identified',
            });
            logger.warn('no target identified; awaiting operator review', { tab: session.label });
            continue;
        }

        const selfFixApplied = await applySelfFix(session, decision, session.history.slice(-10), currentStep);
        if (selfFixApplied) {
            session.ui.summary = 'self-fix applied; re-checking page';
            appendUiAction(session, '[vision] self-fix');
            continue;
        }

        session.ui.status = 'navigating';
        session.ui.summary = `targeting ${decision.targetText}`;
        session.ui.activeAgent = 'nav';
        session.ui.controllerThought = `Seeing ${session.ui.visionThought}; sending nav agent to confirm ${decision.targetText}`;
        appendUiAction(session, decision.targetType === 'input' ? '[vision] filling input' : '[vision] locating apply');
        session.ui.navThought = `Searching for ${decision.targetText}`;
        session.ui.navFeed = [];
        session.ui.liveNavFocus = null;
        session.ui.currentThought = session.ui.controllerThought;
        logger.info('navigation agent starting', { tab: session.label, targetText: decision.targetText, value: decision.value });
        const urlBefore = session.page.url();

        const navResult = await navigateToTarget(session.page, decision.targetText, decision.value, 50, logger, session.apiKey, (message) => {
            session.ui.activeAgent = 'nav';
            session.ui.liveNavFocus = message;
            session.ui.navFeed = [...(session.ui.navFeed || []), message].slice(-12);
            session.ui.controllerThought = `Nav agent is tabbing through the page: ${message}`;
            session.ui.currentThought = session.ui.controllerThought;
        });

        await session.page.waitForTimeout(RUN_CONFIG.postClickDelayMs);
        await ensurePageReady(session.page);

        const urlAfter = session.page.url();
        const pageChanged = urlAfter !== urlBefore;
        const result = navResult.success
            ? pageChanged ? 'clicked — page navigated' : 'clicked — page unchanged'
            : 'target not found';

        const navVerification = verifyNavAgentResult(session, decision, navResult);
        const navReviewState = navResult?.reviewState;
        if (!navVerification.ok || navReviewState?.suspicious) {
            session.ui.status = 'waiting';
            session.ui.summary = navReviewState?.suspicious
                ? 'nav review flagged suspicious navigation; awaiting operator review'
                : 'nav verification failed; awaiting operator review';
            session.ui.attention = true;
            session.ui.reviewReason = navReviewState?.suspicious
                ? 'nav review flagged suspicious navigation'
                : 'nav verification failed';
            session.ui.activeAgent = 'vision';
            session.ui.liveNavFocus = null;
            session.ui.controllerThought = navReviewState?.suspicious
                ? `Nav review flagged suspicious behavior for ${decision.targetText}: ${navReviewState.reason}`
                : `Nav verification failed for ${decision.targetText}: ${navVerification.reason}`;
            session.ui.currentThought = session.ui.controllerThought;
            appendUiAction(session, navReviewState?.suspicious ? '[vision] nav review' : '[vision] recovery');
            logger.warn('navigation verification flagged', { tab: session.label, targetText: decision.targetText, navVerification: navVerification.reason, navReviewState: navReviewState?.reason });
            await waitForOperator(session);
            if (session.ui.killed) {
                break;
            }
            continue;
        }

        session.ui.status = navResult.success ? 'working' : 'waiting';
        session.ui.summary = result;
        session.ui.activeAgent = 'vision';
        session.ui.liveNavFocus = null;
        session.ui.controllerThought = navResult.success
            ? `Nav agent completed the search for ${decision.targetText}. Returning to vision controller.`
            : `Nav agent did not find ${decision.targetText}. Returning to vision controller.`;
        session.ui.currentThought = session.ui.controllerThought;
        if (navResult.thought) {
            session.ui.navThought = navResult.thought;
            session.ui.currentThought = `Vision: ${session.ui.visionThought}; Nav: ${session.ui.navThought}`;
        }
        appendUiAction(session, navResult.success ? '[nav] target found' : '[nav] target missing');
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
            inputValue: decision.value || null,
            thought: session.ui.currentThought,
            navAction: navResult?.thought ?? null,
            navMatched: navResult?.matchedText ?? null,
            navActionType: navResult?.actionType ?? null,
            navTabsTaken: navResult?.tabs ?? null,
            focusedElement: navResult?.focused ?? null,
            controllerActions: (session.ui.controllerActions || []).slice(-8).map((entry) => entry.message),
            navTrace: Array.isArray(navResult?.trace) ? navResult.trace.slice(-8) : [],
            navFeed: Array.isArray(navResult?.liveFeed) ? navResult.liveFeed.slice(-8) : [],
            pageUrl: session.page.url(),
            tabLabel: session.label,
            timestamp: new Date().toISOString(),
        });

        steps++;
    }

    if (steps >= RUN_CONFIG.maxSteps) {
        flagSessionForOperatorReview(session, {
            summary: 'reached max steps; manual review recommended',
            message: 'reached max steps',
            reason: 'max steps reached',
        });
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