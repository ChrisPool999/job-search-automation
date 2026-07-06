import { GoogleGenAI } from '@google/genai';
import { MAX_RPM, COOLDOWN_MS } from '../job-analyzer/config.js';

function createAiClient(apiKey) {
    return new GoogleGenAI({ apiKey });
}

export function createNavigationLogger(logger) {
    return {
        logStep(step, message, data = {}) {
            logger?.info?.(`[nav] ${message}`, { step, ...data });
        },
        logWarn(step, message, data = {}) {
            logger?.warn?.(`[nav] ${message}`, { step, ...data });
        },
    };
}

const NAV_PROMPT = `
You are a keyboard navigation agent tabbing through a webpage.
Your only goal is to find the target element and click it.

Target: "{TARGET_TEXT}"

Currently focused element:
{FOCUSED_ELEMENT}

Rules:
- Return "click" if the focused element matches or closely matches the target
- Return "tab" to move to the next element
- Return "notfound" only if you are confident the target does not exist on this page

Return JSON only, no markdown, no backticks:
{
    "action": "tab" | "click" | "notfound",
    "reason": "why you chose this action"
}
`;

async function getFocusedElementInfo(page) {
    return await page.evaluate(() => {
        const el = document.activeElement;
        return {
            tag: el?.tagName || null,
            type: el?.type || null,
            label: el?.getAttribute('aria-label')
                || el?.getAttribute('placeholder')
                || document.querySelector(`label[for="${el?.id}"]`)?.innerText?.trim()
                || el?.getAttribute('name')
                || el?.innerText?.trim()
                || '',
            role: el?.getAttribute('role') || null,
            id: el?.id || null,
            value: el?.value || null,
            text: el?.innerText?.trim() || null,
            disabled: el?.disabled || false,
        };
    });
}

async function fillFocusedInput(page, focused, value) {
    if (!value) {
        return { success: false, confirmedValue: null };
    }

    const result = await page.evaluate(({ focused, value }) => {
        const activeElement = document.activeElement;
        const input = activeElement && ['INPUT', 'TEXTAREA'].includes(activeElement.tagName)
            ? activeElement
            : (focused?.id ? document.getElementById(focused.id) : null);

        if (!input) {
            return { success: false, confirmedValue: null };
        }

        input.focus();

        if (typeof input.select === 'function') {
            input.select();
        } else if (typeof input.setSelectionRange === 'function') {
            const length = input.value?.length ?? 0;
            input.setSelectionRange(0, length);
        }

        input.value = '';

        if (typeof input.dispatchEvent === 'function') {
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        input.value = value;

        if (typeof input.dispatchEvent === 'function') {
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        return { success: true, confirmedValue: input.value };
    }, { focused, value });

    return result;
}

async function toggleFocusedCheckbox(page, focused) {
    return await page.evaluate(({ focused }) => {
        const activeElement = document.activeElement;
        const input = activeElement && activeElement.tagName === 'INPUT'
            ? activeElement
            : (focused?.id ? document.getElementById(focused.id) : null);

        if (!input || !['checkbox', 'radio'].includes(input.type)) {
            return { success: false, checked: null };
        }

        input.focus();
        input.click();
        return { success: true, checked: !!input.checked };
    }, { focused });
}

export async function navigateToTarget(page, targetText, value = null, maxTabs = 50, logger = null, apiKey = process.env.GEMINI_API_KEY1) {
    const ai = createAiClient(apiKey);
    const navLogger = createNavigationLogger(logger);
    navLogger.logStep(1, `searching for target`, { targetText, maxTabs });

    for (let i = 0; i < maxTabs; i++) {
        const focused = await getFocusedElementInfo(page);
        navLogger.logStep(i + 1, 'focused element', {
            label: focused.label || focused.text || focused.tag,
            tag: focused.tag,
            role: focused.role,
            id: focused.id,
        });

        const contents = [
            {
                text: NAV_PROMPT
                    .replace('{TARGET_TEXT}', targetText)
                    .replace('{FOCUSED_ELEMENT}', JSON.stringify(focused, null, 2))
            }
        ];

        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents,
            config: { responseMimeType: 'application/json' }
        });
        await new Promise((resolve) => setTimeout(resolve, COOLDOWN_MS / MAX_RPM))

        try {
            const result = JSON.parse(response.text);
            navLogger.logStep(i + 1, `model decision: ${result.action}`, { reason: result.reason });

            if (result.action === 'click') {
                if (focused.tag === 'INPUT' || focused.tag === 'TEXTAREA') {
                    if (value) {
                        navLogger.logStep(i + 1, 'typing into input field', { value });
                        const fillResult = await fillFocusedInput(page, focused, value);
                        if (fillResult.success) {
                            navLogger.logStep(i + 1, 'confirmed input value', { confirmedValue: fillResult.confirmedValue });
                            return {
                                success: true,
                                tabs: i + 1,
                                matchedText: focused.label || focused.text,
                                confirmedValue: fillResult.confirmedValue,
                            };
                        }

                        navLogger.logWarn(i + 1, 'failed to confirm input value after typing');
                        return {
                            success: false,
                            tabs: i + 1,
                            matchedText: focused.label || focused.text,
                            confirmedValue: null,
                        };
                    }

                    if (focused.type === 'checkbox' || focused.type === 'radio') {
                        const toggleResult = await toggleFocusedCheckbox(page, focused);
                        navLogger.logStep(i + 1, 'toggling checkbox or radio', { checked: toggleResult.checked });
                        return {
                            success: toggleResult.success,
                            tabs: i + 1,
                            matchedText: focused.label || focused.text,
                            confirmedValue: toggleResult.checked,
                        };
                    }

                    navLogger.logStep(i + 1, 'focused input field without provided value');
                } else {
                    navLogger.logStep(i + 1, 'pressing Enter on focused control');
                    await page.keyboard.press('Enter');
                }
                return {
                    success: true,
                    tabs: i + 1,
                    matchedText: focused.label || focused.text,
                    confirmedValue: focused.value ?? null,
                };
            }

            if (result.action === 'notfound') {
                navLogger.logWarn(i + 1, 'target not found by navigation agent');
                return { success: false, tabs: i + 1, matchedText: null };
            }

        } catch {
            console.error('   Failed to parse nav response:', response.text);
        }

        await page.keyboard.press('Tab');
        await page.waitForTimeout(100);
    }

    navLogger.logWarn(maxTabs, 'hit max tab limit without finding target');
    return { success: false, tabs: maxTabs, matchedText: null, confirmedValue: null };
}