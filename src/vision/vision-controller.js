import "dotenv/config"
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({});

const INDEED_URL = 'https://www.indeed.com/viewjob?jk=929ce2bcae519f17';
const VIEWPORT = { width: 2560, height: 1080 };
let IMAGE_SIZE = { width: VIEWPORT.width, height: VIEWPORT.height };
const SCROLL_STEP = 400;

const RUN_CONFIG = {
    runFolder: path.join('vision-debug', 'latest-run'),
    actionDelayMs: 1500,
    screenshotDelayMs: 600,
    pageReadyDelayMs: 500,
    postClickDelayMs: 3000,
    maxSteps: 25,
};

const DEBUG_DIR = RUN_CONFIG.runFolder;
const ACTION_LOG_PATH = path.join(DEBUG_DIR, 'actions.json');
let debugActions = [];

const PROMPT = `
You are automating a job application on Indeed.
Screenshot is exactly 2560x1080 pixels.
The page has a sticky header/navbar at the top approximately 60px tall.
Account for this when calculating coordinates.

The screenshot may include a red marker showing the previous click location from the last step.
This marker is the previous attempt, not the target.
Compare the red marker to the button or link you want to click.
If the red marker is left of the button, say how many pixels to move right.
If it is above the button, say how many pixels to move down.
If it is too far right, say how many pixels to move left.
Do not ignore the marker.

Always treat this as an iterative feedback loop:
- check the current screenshot and red marker
- compare the marker to the target button
- decide how to move the next click by pixels
- explain the correction in the analysis field

RECENT ACTIONS:
{HISTORY}

HERE ARE THE INSTRUCTIONS: 
1. click "apply on company site"
2. click on login with google 
3. you can insert as you like here, remember, you need to click on buttons to enter info first, eg "email". 

Return JSON only, no markdown, no backticks:
{
    "action": "click" | "type" | "scroll" | "done",
    "boundingBox": { "x": 0, "y": 0, "width": 0, "height": 0 },
    "text": "only if action is type",
    "description": "what you see and what you are doing",
    "analysis": "a short sentence describing why you chose this action and how you are correcting the previous click, including pixel adjustment if applicable",
    "reason": "only if action is done"
}
`;

async function ensurePageReady(page) {
    try {
        await page.bringToFront();
    } catch (e) {
        // ignore
    }

    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await page.waitForTimeout(RUN_CONFIG.pageReadyDelayMs);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function visionStep(page, recentActions = [], feedbackImage = null) {
    await ensurePageReady(page);
    const buffer = feedbackImage
        ? Buffer.from(feedbackImage, 'base64')
        : await page.screenshot({ fullPage: false });
    const base64Image = buffer.toString('base64');

    // determine actual screenshot size inside the page context (avoids extra deps)
    try {
        const imageSize = await page.evaluate((b64) => new Promise((resolve, reject) => {
            const img = new Image();
            img.src = 'data:image/png;base64,' + b64;
            img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
            img.onerror = (e) => reject(e);
        }), base64Image);
        IMAGE_SIZE = { width: imageSize.width, height: imageSize.height };
        console.log(`   screenshot size: ${IMAGE_SIZE.width}x${IMAGE_SIZE.height}`);
    } catch (e) {
        console.warn('Could not determine screenshot size:', e.message || e);
    }

    const historyText = recentActions.length > 0
        ? `Previous actions:\n${recentActions.map(a => `${a.step}. ${a.action} at (${a.x}, ${a.y}) — ${a.result}`).join('\n')}`
        : 'No previous actions.';

    const promptWithHistory = PROMPT.replace('{HISTORY}', historyText);

    const contents = [
        {
            inlineData: {
                mimeType: 'image/png',
                data: base64Image,
            },
        },
        { text: promptWithHistory },
    ];

    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: contents,
    });

    try {
        const clean = response.text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        if (parsed.analysis) {
            console.log(`   Gemini thought: ${parsed.analysis}`);
        } else {
            const firstLine = response.text.trim().split('\n')[0];
            console.log(`   Gemini thought: ${firstLine}`);
        }
        return parsed;
    } catch {
        console.error('Failed to parse Gemini response:', response.text);
        return { action: 'done', reason: 'parse error' };
    }
}

async function prepareDebugDir() {
    if (fs.existsSync(DEBUG_DIR)) {
        await fs.promises.rm(DEBUG_DIR, { recursive: true, force: true });
    }
    await fs.promises.mkdir(DEBUG_DIR, { recursive: true });
    debugActions = [];
    await fs.promises.writeFile(ACTION_LOG_PATH, JSON.stringify(debugActions, null, 2));
}

function screenshotFileName(step, action) {
    const stepNum = String(step).padStart(2, '0');
    const safeAction = action ? action.replace(/[^a-z0-9_-]/gi, '_').toLowerCase() : 'unknown';
    return `${stepNum}-${safeAction}.png`;
}

async function saveClickScreenshot(page, action, step) {
    if (action.action !== 'click') {
        return { screenshotPath: null, feedbackImage: null };
    }

    const box = action.boundingBox;
    const scaleX = IMAGE_SIZE.width / VIEWPORT.width;
    const scaleY = IMAGE_SIZE.height / VIEWPORT.height;
    const x = box ? Math.round(box.x * scaleX + (box.width * scaleX) / 2) : null;
    const y = box ? Math.round(box.y * scaleY + (box.height * scaleY) / 2) : null;
    const screenshotName = screenshotFileName(step, action.action);
    const filename = path.join(DEBUG_DIR, screenshotName);
    const inputScreenshotName = `${String(step).padStart(2, '0')}-input.png`;
    const inputFilename = path.join(DEBUG_DIR, inputScreenshotName);
    const label = `${step}. ${action.action}`;

    await ensurePageReady(page);
    const inputBuffer = await page.screenshot({ fullPage: false });
    await fs.promises.writeFile(inputFilename, inputBuffer);

    await page.waitForTimeout(RUN_CONFIG.screenshotDelayMs);

    await page.evaluate(({ x, y, label }) => {
        let overlay = document.getElementById('__ai_step_overlay__');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = '__ai_step_overlay__';
            overlay.style.position = 'absolute';
            overlay.style.left = '0';
            overlay.style.top = '0';
            overlay.style.width = '100%';
            overlay.style.height = '100%';
            overlay.style.pointerEvents = 'none';
            overlay.style.zIndex = '2147483647';
            document.body.appendChild(overlay);
        }

        if (x !== null && y !== null) {
            overlay.innerHTML = `
                <div style="position:absolute; left:${x - 24}px; top:${y - 24}px; width:48px; height:48px; border:4px solid red; border-radius:50%; box-shadow:0 0 0 8px rgba(255,0,0,0.25);"></div>
                <div style="position:absolute; left:${x + 32}px; top:${y - 18}px; padding:8px 12px; background:rgba(0,0,0,0.85); color:white; font:15px sans-serif; border-radius:8px; white-space:nowrap;">${label}</div>
            `;
        } else {
            overlay.innerHTML = `
                <div style="position:absolute; left:20px; top:20px; padding:10px 14px; background:rgba(0,0,0,0.85); color:white; font:15px sans-serif; border-radius:8px; white-space:nowrap;">${label}</div>
            `;
        }
    }, { x, y, label });

    const annotatedBuffer = await page.screenshot({ path: filename, fullPage: false });
    await page.evaluate(() => {
        const overlay = document.getElementById('__ai_step_overlay__');
        if (overlay) overlay.remove();
    });
    return { screenshotPath: filename, feedbackImage: annotatedBuffer.toString('base64') };
}

async function logAction(action, step, result, screenshotName = null) {
    debugActions.push({
        step,
        action: action.action,
        x: action.boundingBox ? action.boundingBox.x : null,
        y: action.boundingBox ? action.boundingBox.y : null,
        boundingBox: action.boundingBox || null,
        text: action.text ?? null,
        description: action.description ?? null,
        result,
        screenshot: screenshotName,
        timestamp: new Date().toISOString(),
    });
    await fs.promises.writeFile(ACTION_LOG_PATH, JSON.stringify(debugActions, null, 2));
}

async function executeAction(page, action) {
    const box = action.boundingBox;
    const scaleX = IMAGE_SIZE.width / VIEWPORT.width;
    const scaleY = IMAGE_SIZE.height / VIEWPORT.height;
    const x = box ? Math.round(box.x * scaleX + (box.width * scaleX) / 2) : null;
    const y = box ? Math.round(box.y * scaleY + (box.height * scaleY) / 2) : null;

    switch (action.action) {
        case 'click':
            if (x !== null && y !== null) {
                await page.mouse.click(x, y);
            }
            break;
        case 'type':
            if (action.text) await page.keyboard.type(action.text);
            break;
        case 'scroll':
            await page.evaluate((step) => window.scrollBy(0, step), SCROLL_STEP);
            await page.waitForTimeout(500);
            break;
        case 'done':
            break;
        default:
            // unknown action
    }
}

export async function runVisionLoop(url = INDEED_URL) {
    console.log('Vision loop starting...\n');
    const browser = await chromium.launch({ headless: false, args: ['--start-maximized', `--window-size=${VIEWPORT.width},${VIEWPORT.height}`] });
    const context = await browser.newContext({ viewport: VIEWPORT, screen: VIEWPORT });
    const page = await context.newPage();
    await page.bringToFront();

    try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
        await ensurePageReady(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await ensurePageReady(page);

        let steps = 0;

        await prepareDebugDir();

        const actionHistory = [];
        let feedbackImage = null;

        while (steps < RUN_CONFIG.maxSteps) {
            const currentStep = steps + 1;
            const action = await visionStep(page, actionHistory.slice(-5), feedbackImage);

            if (action.action === 'done') {
                console.log(`\n✓ Done: ${action.reason}`);
                break;
            }

            console.log(`Step ${currentStep}: ${action.description || action.action}`);

            const urlBefore = page.url();
            const maybeBodyLengthBefore = await page.evaluate(() => document.body.innerText.length).catch(() => 0);
            await executeAction(page, action);
            await page.waitForTimeout(RUN_CONFIG.postClickDelayMs);

            const urlAfter = page.url();
            const maybeBodyLengthAfter = await page.evaluate(() => document.body.innerText.length).catch(() => 0);
            const pageChanged = urlAfter !== urlBefore || Math.abs(maybeBodyLengthAfter - maybeBodyLengthBefore) > 20;
            const result = action.action === 'click'
                ? pageChanged ? 'page changed after click' : 'page did not change — click may have missed'
                : action.action === 'scroll'
                    ? 'scrolled'
                    : action.action === 'type'
                        ? 'typed'
                        : 'done';

            const screenshotData = await saveClickScreenshot(page, action, currentStep);
            await logAction(action, currentStep, result, screenshotData.screenshotPath);
            feedbackImage = screenshotData.feedbackImage;

            actionHistory.push({
                step: currentStep,
                action: action.action,
                x: action.boundingBox ? Math.round(action.boundingBox.x) : null,
                y: action.boundingBox ? Math.round(action.boundingBox.y) : null,
                description: action.description ?? null,
                result,
            });

            await page.waitForTimeout(RUN_CONFIG.actionDelayMs);
            steps++;
        }

        if (steps >= RUN_CONFIG.maxSteps) {
            console.log('Hit max steps — needs manual review.');
        }

        const finalStatePath = path.join(DEBUG_DIR, 'final-state.png');
        await page.screenshot({ path: finalStatePath });

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
