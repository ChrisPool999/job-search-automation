import { GoogleGenAI } from '@google/genai';
import { MAX_RPM, COOLDOWN_MS } from '../job-analyzer/config.js';

const ai = new GoogleGenAI({});

const DIRECTOR_PROMPT = `
You are a vision agent analyzing a job application page screenshot.
Your job is to identify the single most important button or action to take next, this includes entering text into a form field, so it's on you to discern whether text will populate the form, aka the form is focused.

Screenshot is exactly 2560x1080 pixels.

Rules:
- Focus only on progressing through the job application flow
- Ignore search bars, navigation links, sign in buttons
- If you see an apply button, that is the target
- If you see a form, identify the next unfilled field
- If you see a summary/review page, the task is complete

Cycle detection: if recent history shows the same action repeated 3+ times with no page change, 
flag it as a cycle and return done.

RECENT HISTORY:
{HISTORY}

Return JSON only, no markdown, no backticks:
{
    "targetText": "exact visible text of the button or element to interact with",
    "targetType": "button" | "input" | "link" | "done",
    "value": "value to type if targetType is input, null otherwise",
    "pageState": "job_listing" | "application_form" | "login" | "summary" | "unknown",
    "isCycle": true | false,
    "description": "what you see on the page and why you chose this target",
    "confidence": 0.0
}
`;

export async function getDirectorDecision(page, history = []) {
    const buffer = await page.screenshot({ fullPage: false });
    const base64Image = buffer.toString('base64');

    const historyText = history.length > 0
        ? history.map(h => `${h.step}. targeted "${h.targetText}" — result: ${h.result}`).join('\n')
        : 'No previous actions.';

    const prompt = DIRECTOR_PROMPT.replace('{HISTORY}', historyText);

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