import "dotenv/config"
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import { getDirectorDecision } from './vision-director.js';
import { navigateToTarget } from './navigation-agent.js';

const INDEED_URL = 'https://www.indeed.com/viewjob?jk=929ce2bcae519f17';
const VIEWPORT = { width: 2560, height: 1080 };

const RUN_CONFIG = {
    runFolder: path.join('vision-debug', 'latest-run'),
    maxSteps: 25,
    postClickDelayMs: 3000,
    pageReadyDelayMs: 500,
};

const DEBUG_DIR = RUN_CONFIG.runFolder;
const ACTION_LOG_PATH = path.join(DEBUG_DIR, 'actions.json');
let debugActions = [];

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
        console.log('   ⚠️ page ready timeout, continuing anyway');
    }
    await page.waitForTimeout(RUN_CONFIG.pageReadyDelayMs);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function saveStepScreenshot(page, step, label) {
    const stepNum = String(step).padStart(2, '0');
    const filename = path.join(DEBUG_DIR, `${stepNum}-${label}.png`);
    await page.screenshot({ path: filename, fullPage: false });
    return filename;
}

async function logAction(step, decision, navResult) {
    debugActions.push({
        step,
        targetText: decision.targetText,
        pageState: decision.pageState,
        confidence: decision.confidence,
        description: decision.description,
        navSuccess: navResult?.success ?? null,
        tabsTaken: navResult?.tabs ?? null,
        matchedText: navResult?.matchedText ?? null,
        timestamp: new Date().toISOString(),
    });
    await fs.promises.writeFile(ACTION_LOG_PATH, JSON.stringify(debugActions, null, 2));
}

export async function runVisionLoop(url = INDEED_URL) {
    console.log('Starting orchestrator...\n');

    const browser = await chromium.launch(
        '/mnt/c/Users/brisb/AppData/Local/Google/Chrome/User Data',
    {
        headless: false,
        args: ['--start-maximized', `--window-size=${VIEWPORT.width},${VIEWPORT.height}`]
    });
    const context = await browser.newContext({ viewport: VIEWPORT, screen: VIEWPORT });
    const page = await context.newPage();
    await page.bringToFront();

    try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
        await ensurePageReady(page);
        await prepareDebugDir();

        let steps = 0;
        const directorHistory = [];

        while (steps < RUN_CONFIG.maxSteps) {
            const currentStep = steps + 1;
            console.log(`\n=== Step ${currentStep}/${RUN_CONFIG.maxSteps} ===`);

            // --- Vision Director decides what to click ---
            console.log('Director analyzing page...');
            const decision = await getDirectorDecision(page, directorHistory.slice(-5));
            console.log(`Director: "${decision.targetText}" (${decision.pageState}) confidence: ${decision.confidence}`);
            console.log(`Director: ${decision.description}`);

            await saveStepScreenshot(page, currentStep, 'director');

            if (decision.targetType === 'done' || decision.pageState === 'summary') {
                console.log('\n✓ Director says done');
                await logAction(currentStep, decision, null);
                break;
            }

            if (decision.isCycle) {
                console.log('\n⚠️ Cycle detected — flagging for manual review');
                await logAction(currentStep, decision, null);
                break;
            }

            if (!decision.targetText) {
                console.log('\n⚠️ No target identified — skipping step');
                steps++;
                continue;
            }

            // --- Nav Agent finds and clicks the target ---
            console.log(`\nNav agent looking for: "${decision.targetText}"`);
            const urlBefore = page.url();

            const navResult = await navigateToTarget(page, decision.targetText, decision.value);

            await page.waitForTimeout(RUN_CONFIG.postClickDelayMs);
            await ensurePageReady(page);

            const urlAfter = page.url();
            const pageChanged = urlAfter !== urlBefore;
            const result = navResult.success
                ? pageChanged ? 'clicked — page navigated' : 'clicked — page unchanged'
                : 'target not found';

            console.log(`Result: ${result}`);
            await saveStepScreenshot(page, currentStep, 'after');
            await logAction(currentStep, decision, { ...navResult, result });

            directorHistory.push({
                step: currentStep,
                targetText: decision.targetText,
                result,
            });

            steps++;
        }

        if (steps >= RUN_CONFIG.maxSteps) {
            console.log('\nHit max steps — needs manual review.');
        }

        const finalPath = path.join(DEBUG_DIR, 'final-state.png');
        await page.screenshot({ path: finalPath });
        console.log(`\nFinal screenshot: ${finalPath}`);

    } catch (err) {
        console.error('\n✗ Error:', err.message);
        throw err;
    } finally {
        await browser.close();
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