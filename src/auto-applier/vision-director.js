import { GoogleGenAI } from '@google/genai';
import { MAX_RPM, COOLDOWN_MS } from '../job-analyzer/config.js';

function getEnvValue(name) {
    return String(process.env[name] || '').trim();
}

const ENV_EMAIL = getEnvValue('EMAIL');
const ENV_PASSWORD = getEnvValue('PASSWORD');
const HAS_ENV_CREDENTIALS = Boolean(ENV_EMAIL && ENV_PASSWORD);

function createAiClient(apiKey) {
    return new GoogleGenAI({ apiKey });
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

function buildControllerActionSummary(historyEntry) {
    const actions = Array.isArray(historyEntry?.controllerActions) ? historyEntry.controllerActions : [];
    if (!actions.length) {
        return '';
    }
    const recentActions = actions.slice(-4).map((action) => shortText(action, 20));
    return ` [ctrl:${recentActions.join(' > ')}]`;
}

export function buildRecentTaskHistory(history) {
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
        if (entry.navActionType) navParts.push(`act:${entry.navActionType}`);
        const focusedLabel = entry.focusedElement ? ` focused:${shortText(entry.focusedElement.label || entry.focusedElement.text || entry.focusedElement.id, 20)}` : '';
        const tabLabel = entry.tabLabel ? ` tab:${entry.tabLabel}` : '';
        const navLabel = navParts.length ? ` [nav:${navParts.join(',')}]` : '';
        const controllerLabel = buildControllerActionSummary(entry);
        return `${index + 1}. ${task}${result}${navLabel}${controllerLabel}${focusedLabel}${tabLabel}`;
    }).join('\n');
}

function buildRecentControllerActions(history) {
    const recent = history.slice(-6);
    const withActions = recent.filter((entry) => Array.isArray(entry.controllerActions) && entry.controllerActions.length);
    if (!withActions.length) {
        return 'No recent controller actions.';
    }
    return withActions.map((entry, index) => {
        const label = entry.targetText || entry.description || `step ${index + 1}`;
        const actions = entry.controllerActions.slice(-4).map((action) => shortText(action, 24)).join(' | ');
        return `${index + 1}. ${shortText(label, 24)} -> ${actions}`;
    }).join('\n');
}

const APPLICATION_FORM_RULES = `
Application form completion rules (consult these when you are uncertain how to proceed):
- Prefer uploading a resume/CV over manually filling fields when the page offers an obvious upload option such as "Upload resume", "Upload CV", "Attach resume", "Use my resume", or similar, and the site appears to support resume-based application.
- If both resume upload and manual entry are available, choose resume upload first unless the page clearly requires manual completion or the upload option is disabled, unavailable, or obviously not applicable.
- Do not force resume upload in every case. If the page clearly expects manual form completion, or the upload action is blocked, failed, or not supported, proceed with the manual path instead.
- When you are unsure which path to take, follow this priority: 1) resume upload/auto-fill, 2) prefilled or assisted form flow, 3) the smallest set of manual fields needed to continue.
`;

const FAQ_PATH = 'faq/agent-faq.md';

const FAQ_RULES = `
Personal info FAQ / memory rules (consult this when a form asks for personal details):
- Keep the FAQ file at ${FAQ_PATH} compact, alphabetized, and easy to search.
- The file's top comment says entries must remain alphabetized; if you notice entries are out of order, fix them.
- Use simple canonical labels such as "First Name", "Last Name", "Email Address", or "Phone Number" so lookups are easy and duplicates are avoided.
- Before asking the user for a personal detail, search the FAQ for a matching or near-matching key.
- If the answer is already in the FAQ, use it and do not ask the user again.
- If the value is not present and you cannot safely infer it, ask the user for it once.
- After the user provides it, add or update a single concise FAQ entry in the canonical label format and keep the file short.
- If a near-duplicate already exists, update that entry instead of creating a second one.
`;

const ATTEMPT_FIX_RULES = `
Attempt-fix mode (use this when a step fails, stalls, looks blocked, or needs attention):
1. Analyze the recent navigation history, tabs, and prior actions to determine whether the problem looks like a navigation-agent issue rather than a form or page issue.
2. If it appears to be a navigation-agent issue, retry the action using the navigation agent again from the current state rather than repeating the same failed approach blindly.
3. Refresh or re-read the current screen before concluding the issue is real; make sure it is not a temporary latency, stale state, or delayed page update problem.
- Use this mode before asking for operator help if progress is blocked and another targeted retry is still reasonable.
- Do not use this mode for every small step; only use it when the task seems stuck, failed, or needs attention.
`;

const DIRECTOR_PROMPT = `
You are a vision agent analyzing a job application page screenshot.
Your job is to identify the single most important button or action to take next, this includes entering text into a form field, so it's on you to discern whether text will populate the form, aka the form is focused.

Screenshot is exactly 2560x1080 pixels.

Operator instruction:
{OPERATOR_INSTRUCTION}

Tab: {TAB_LABEL}

Scope:
- The link provided was sourced externally (not discovered by you) and points to one specific job listing.
- Your task is limited to that single listing only: fill out and submit the application for the job shown on initial page load.
- Do not navigate to, click into, or apply for any other job listing, even if suggested, related, or more prominent on the page (e.g. "similar jobs," "you may also like," other openings from the same employer).
- If the page indicates the job is no longer available, closed, filled, or expired (e.g. "this position has been filled," "job no longer accepting applications," 404/removed listing), stop immediately. Flag this and do not attempt to search for, click into, or apply to a different listing as a substitute.

Goal:
- Do as much of the application flow as possible by yourself.
- Use human help only when you are stuck or trapped in a repeated loop that you cannot safely break.

Rules:
- Focus only on progressing through the job application flow
- Ignore search bars, navigation links, and unrelated site navigation buttons
- If you see an apply button, that is the target
- If you see a form, identify the next unfilled field or required action
- If you see a summary/review page, the task is complete

Application form handling (consult when unsure):
{APPLICATION_FORM_RULES}

Personal info FAQ / memory handling (consult when a form asks for personal details):
{FAQ_RULES}

Attempt-fix mode (consult when a step fails, stalls, looks blocked, or needs attention):
{ATTEMPT_FIX_RULES}

Account creation priority (applies once you reach an account/sign-up step, typically right after clicking Apply):
When a page asks you to sign in, register, or create an account, treat it as a new-account flow unless the page clearly shows an existing account / login path after signup failure.
Use this exact priority order:
1. Create a new account through the visible account-creation option (for example "Sign up," "Create account," "Register," "Join now," or similar) — always choose this first when it is available.
2. If the page only shows a login form and the site clearly indicates an existing account is required, then use the login path.
3. Do not use Google, OAuth, or "Continue with Google" options. Ignore them entirely.

Account and sign-up handling:
- If the page asks for email and password, assume the goal is to create a new account, not to log in to an existing one.
- Use the environment credentials to fill the email/password fields for account creation when those fields are present.
- If the page shows a sign-up form, fill it as a new account creation flow.
- If the page shows a login form and there is no clear evidence of an existing account, treat it as a create-account step and choose the registration/signup option instead of logging in.
- Keep all credentials handling secure and avoid exposing secrets in the reasoning or output.

Credentials hint:
{CREDENTIALS_HINT}

Self-fix on stalled progress:
- RECENT TASKS below includes, for each past step, the action taken and its outcome (e.g. whether the page changed, whether the nav agent reported an error or failed to click/type, and any nav agent reasoning in square brackets).
- Before picking your target, check whether recent steps show the same target being attempted repeatedly with no page change, or the nav agent reporting it could not find or interact with your last target.
- If so, do not repeat the same target again. Instead, diagnose the likely cause from the screenshot and history, and adjust your approach, for example:
  - If a click failed or did nothing, the element may require scrolling into view first, may be obscured by an overlay/modal/cookie banner, or your targetText may not exactly match visible text — re-read the screenshot and pick the exact visible label, or target the overlay/close button blocking it first.
  - If typing into a field failed to populate it, the field may not have been focused first — target a click on the field before targeting a type action.
  - If a button click isn't advancing the page, check for a validation error or required field you missed above it.
  - If none of the above explains it after 2-3 varied attempts, treat it as a genuine cycle: set selfFixAttempted to true, set isCycle to true, and return done rather than continuing to guess.
- Only mark isCycle true after you have tried at least one alternate approach informed by the history, not on the first repeated failure.

Cycle detection: if recent history shows the same short task repeated 3+ times with no page change,
flag it as a cycle and return done.
- Short task names are provided to help you see loops without too much token cost.
- If you are unsure or stuck, ask for operator attention by choosing a safe target or returning done if no progress is possible.

RECENT TASKS:
{HISTORY}

RECENT CONTROLLER ACTIONS:
{CONTROLLER_ACTIONS}

Sanity and traversal check:
- Review the recent controller actions and recent tasks together before choosing a target.
- If the same field, button, or page state is being retried with no meaningful progress, or the flow appears to be resetting back to a prior screen, treat that as a likely loop or wrong-place traversal.
- Do not repeat the same action blindly; choose a safer alternate target or set isCycle to true and stop rather than continuing in circles.

Return JSON only, no markdown, no backticks:
{
    "targetText": "exact visible text of the button or element to interact with",
    "targetType": "button" | "input" | "link" | "done",
    "value": "value to type if targetType is input, null otherwise",
    "pageState": "job_listing" | "application_form" | "login" | "signup" | "summary" | "job_unavailable" | "unknown",
    "isCycle": true | false,
    "jobUnavailable": true | false,
    "selfFixAttempted": true | false,
    "finalName": "optional short reason or label when the task is complete, e.g. no longer hiring",
    "description": "what you see on the page and why you chose this target",
    "confidence": 0.0
}
`;

export async function getNavigationSanityReview(page, history = [], tabLabel = 'tab-1', apiKey = process.env.GEMINI_API_KEY1, operatorInstruction = null, decision = null, navResult = null) {
    const ai = createAiClient(apiKey);
    const buffer = await page.screenshot({ fullPage: false });
    const base64Image = buffer.toString('base64');

    const historyText = buildRecentTaskHistory(history);
    const controllerActionsText = buildRecentControllerActions(history);
    const recentTrace = Array.isArray(navResult?.trace) ? navResult.trace.slice(-8).map((entry) => `${entry.stage || 'step'}:${entry.action || 'unknown'}:${entry.focusedLabel || 'unknown'}`).join('\n') : 'none';
    const recentFeed = Array.isArray(navResult?.liveFeed) ? navResult.liveFeed.slice(-8).join('\n') : 'none';
    const targetText = decision?.targetText || 'unknown target';

    const prompt = `
You are the controller manager reviewing a navigation agent's recent behavior.
The screenshot shows the current page state. The nav agent was trying to reach: ${targetText}.
Assess whether the recent tabbing and navigation steps make sense for the screenshot and the target.
Use common sense and visible page context. Focus on whether the agent is repeatedly tabbing through empty or irrelevant content, looping through the same area, or making no progress toward the target.
If the agent is just pressing Tab over and over through generic containers, empty divs, or a cookie banner without making progress, mark this as suspicious.

Recent tasks:
${historyText}

Recent controller actions:
${controllerActionsText}

Recent nav trace:
${recentTrace}

Recent nav feed:
${recentFeed}

Operator instruction:
${operatorInstruction || 'none'}

Return JSON only, no markdown, no backticks:
{
  "suspicious": true,
  "reason": "brief explanation of why the recent navigation looks suspicious or sensible",
  "confidence": 0.0,
  "recommendedAction": "continue" | "review" | "retry"
}
`;

    const contents = [
        { inlineData: { mimeType: 'image/png', data: base64Image } },
        { text: prompt },
    ];

    const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents,
    });
    await new Promise((resolve) => setTimeout(resolve, COOLDOWN_MS / MAX_RPM));

    try {
        const clean = response.text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        return {
            suspicious: Boolean(parsed?.suspicious),
            reason: String(parsed?.reason || 'navigation sanity review completed'),
            confidence: Number(parsed?.confidence ?? 0),
            recommendedAction: String(parsed?.recommendedAction || 'continue'),
        };
    } catch {
        return {
            suspicious: false,
            reason: 'navigation sanity review parse error',
            confidence: 0,
            recommendedAction: 'continue',
        };
    }
}

export async function getDirectorDecision(page, history = [], tabLabel = 'tab-1', apiKey = process.env.GEMINI_API_KEY1, operatorInstruction = null) {
    const ai = createAiClient(apiKey);
    const buffer = await page.screenshot({ fullPage: false });
    const base64Image = buffer.toString('base64');

    const historyText = buildRecentTaskHistory(history);
    const controllerActionsText = buildRecentControllerActions(history);

    const credentialsHint = HAS_ENV_CREDENTIALS
        ? `Use manual login or account creation credentials from environment variables: email=${ENV_EMAIL}, password=${ENV_PASSWORD}.`
        : 'No environment credentials are provided for manual login or account creation.';

    const prompt = DIRECTOR_PROMPT
        .replace('{HISTORY}', historyText)
        .replace('{CONTROLLER_ACTIONS}', controllerActionsText)
        .replace('{OPERATOR_INSTRUCTION}', operatorInstruction ? operatorInstruction : 'none')
        .replace('{TAB_LABEL}', tabLabel)
        .replace('{CREDENTIALS_HINT}', credentialsHint)
        .replace('{APPLICATION_FORM_RULES}', APPLICATION_FORM_RULES)
        .replace('{FAQ_RULES}', FAQ_RULES)
        .replace('{ATTEMPT_FIX_RULES}', ATTEMPT_FIX_RULES);

    const contents = [
        { inlineData: { mimeType: 'image/png', data: base64Image } },
        { text: prompt },
    ];

    const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents,
    });
    await new Promise((resolve) => setTimeout(resolve, COOLDOWN_MS / MAX_RPM))

    try {
        const clean = response.text.replace(/```json|```/g, '').trim();
        return JSON.parse(clean);
    } catch {
        console.error('Director failed to parse response:', response.text);
        return { targetText: null, targetType: 'done', pageState: 'unknown', isCycle: false, description: 'parse error', confidence: 0 };
    }
}