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

const DIRECTOR_PROMPT = `
You are a vision agent analyzing a job application page screenshot.
Your job is to identify the single most important button or action to take next, this includes entering text into a form field, so it's on you to discern whether text will populate the form, aka the form is focused.

Screenshot is exactly 2560x1080 pixels.

Operator instruction:
{OPERATOR_INSTRUCTION}

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
- Prefer Google OAuth / Sign in with Google when offered as a sign-in option
- If Google OAuth is available, choose it over manual email/password entry
- If the page offers manual email/password fields and environment credentials are provided, use those fields to sign in or create an account as needed
- If creating an account, use the same credentials given in the environment variables
- If manual sign in is required and credentials are not available, report the login entry as the next target and do not invent credentials
- Keep all credentials handling secure and avoid exposing secrets in the reasoning or output

Credentials hint:
{CREDENTIALS_HINT}

Cycle detection: if recent history shows the same short task repeated 3+ times with no page change,
flag it as a cycle and return done.
- Short task names are provided to help you see loops without too much token cost.
- If you are unsure or stuck, ask for operator attention by choosing a safe target or returning done if no progress is possible.

RECENT TASKS:
{HISTORY}

Return JSON only, no markdown, no backticks:
{
    "targetText": "exact visible text of the button or element to interact with",
    "targetType": "button" | "input" | "link" | "done",
    "value": "value to type if targetType is input, null otherwise",
    "pageState": "job_listing" | "application_form" | "login" | "summary" | "job_unavailable" | "unknown",
    "isCycle": true | false,
    "jobUnavailable": true | false,
    "finalName": "optional short reason or label when the task is complete, e.g. no longer hiring",
    "description": "what you see on the page and why you chose this target",
    "confidence": 0.0
}
`;

export async function getDirectorDecision(page, history = [], apiKey = process.env.GEMINI_API_KEY1, operatorInstruction = null) {
    const ai = createAiClient(apiKey);
    const buffer = await page.screenshot({ fullPage: false });
    const base64Image = buffer.toString('base64');

    const historyText = buildRecentTaskHistory(history);

    const credentialsHint = HAS_ENV_CREDENTIALS
        ? `Use manual login or account creation credentials from environment variables: email=${ENV_EMAIL}, password=${ENV_PASSWORD}.`
        : 'No environment credentials are provided for manual login or account creation.';

    const prompt = DIRECTOR_PROMPT
        .replace('{HISTORY}', historyText)
        .replace('{OPERATOR_INSTRUCTION}', operatorInstruction ? operatorInstruction : 'none')
        .replace('{CREDENTIALS_HINT}', credentialsHint);

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