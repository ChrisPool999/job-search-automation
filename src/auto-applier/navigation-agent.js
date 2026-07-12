import { GoogleGenAI } from '@google/genai';
import { MAX_RPM, COOLDOWN_MS } from '../job-analyzer/config.js';
import { getNavigationSanityReview } from './vision-director.js';

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
- Return "click" if the focused element matches or closely matches the target and is a normal clickable control
- Return "enter" if the focused element is a button-like control such as a submit button and should be activated with the Enter key
- Return "tab" to move to the next element
- Return "notfound" only if you are confident the target does not exist on this page

Return JSON only, no markdown, no backticks:
{
    "action": "tab" | "click" | "enter" | "notfound",
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
            text: (() => {
                const rawText = el?.innerText?.trim() || '';
                return rawText && rawText.length <= 80 ? rawText : null;
            })(),
            disabled: el?.disabled || false,
        };
    });
}

function summarizeFocusedElement(focused) {
    if (!focused) return 'unknown';

    if (focused.tag === 'BODY' || focused.tag === 'HTML' || focused.role === 'document') {
        return 'page';
    }

    const candidate = focused.label || focused.text || focused.value || '';
    if (candidate && String(candidate).trim().length <= 60) {
        return String(candidate).trim();
    }

    if (focused.tag && ['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL'].includes(focused.tag)) {
        return focused.tag.toLowerCase();
    }

    return focused.tag || 'unknown';
}

function formatFocusedMessage(step, focused, prefix = 'Tab') {
    const label = summarizeFocusedElement(focused);
    const tag = focused?.tag || 'element';
    const type = focused?.type ? `/${focused.type}` : '';
    return `${prefix} ${step}: ${label} [${tag}${type}]`;
}

function isButtonLikeControl(focused) {
    if (!focused) return false;
    const tag = String(focused.tag || '').toUpperCase();
    const type = String(focused.type || '').toLowerCase();
    return tag === 'BUTTON'
        || tag === 'A'
        || (tag === 'INPUT' && ['button', 'submit', 'reset'].includes(type))
        || focused.role === 'button'
        || ['button', 'submit', 'reset'].includes(type);
}

function emitLiveFeed(onLiveFeed, message) {
    try {
        onLiveFeed?.(message);
    } catch {}
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

async function clickFocusedControl(page, focused) {
    return await page.evaluate(({ focused }) => {
        const activeElement = document.activeElement;
        const control = activeElement && ['BUTTON', 'A', 'INPUT', 'SELECT'].includes(activeElement.tagName)
            ? activeElement
            : (focused?.id ? document.getElementById(focused.id) : null);

        if (!control) {
            return { success: false };
        }

        const isButtonLike = control.tagName === 'BUTTON'
            || control.tagName === 'A'
            || control.tagName === 'INPUT'
            || control.getAttribute('role') === 'button'
            || ['button', 'submit', 'reset'].includes(control.type || '');

        if (!isButtonLike) {
            return { success: false };
        }

        control.focus();
        control.click();
        control.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return { success: true };
    }, { focused });
}

export async function navigateToTarget(page, targetText, value = null, maxTabs = 50, logger = null, apiKey = process.env.GEMINI_API_KEY1, onLiveFeed = null) {
    const ai = createAiClient(apiKey);
    const navLogger = createNavigationLogger(logger);
    const trace = [];
    const liveFeed = [];
    let reviewState = null;
    navLogger.logStep(1, `searching for target`, { targetText, maxTabs });

    for (let i = 0; i < maxTabs; i++) {
        const focused = await getFocusedElementInfo(page);
        const focusedLabel = summarizeFocusedElement(focused);
        trace.push({
            step: i + 1,
            stage: 'inspect',
            action: 'inspect',
            focusedLabel,
            tag: focused.tag,
            role: focused.role,
            id: focused.id,
        });
        const liveFocusMessage = formatFocusedMessage(i + 1, focused);
        liveFeed.push(liveFocusMessage);
        emitLiveFeed(onLiveFeed, liveFocusMessage);
        navLogger.logStep(i + 1, 'focused element', {
            label: focusedLabel,
            tag: focused.tag,
            role: focused.role,
            id: focused.id,
        });

        if ((i + 1) % 10 === 0) {
            const sanityReview = await getNavigationSanityReview(
                page,
                [],
                'nav-agent',
                apiKey,
                null,
                { targetText },
                { trace: trace.slice(-8), liveFeed: liveFeed.slice(-8) },
            );
            reviewState = {
                suspicious: Boolean(sanityReview?.suspicious),
                reason: sanityReview?.reason || 'navigation sanity review completed',
                tabs: i + 1,
            };
            if (reviewState.suspicious) {
                emitLiveFeed(onLiveFeed, `[review] ${reviewState.reason}`);
                navLogger.logWarn(i + 1, 'navigation sanity review flagged suspicious exploration', { reason: reviewState.reason });
                return {
                    success: false,
                    tabs: i + 1,
                    matchedText: focused.label || focused.text,
                    confirmedValue: null,
                    thought: 'Navigation sanity review flagged suspicious exploration',
                    focused,
                    actionType: 'review',
                    trace,
                    liveFeed,
                    reviewState,
                };
            }
        }

        const contents = [
            {
                text: NAV_PROMPT
                    .replace('{TARGET_TEXT}', targetText)
                    .replace('{FOCUSED_ELEMENT}', JSON.stringify(focused, null, 2))
            }
        ];

        let response;
        try {
            response = await ai.models.generateContent({
                model: 'gemini-3.1-flash-lite',
                contents,
                config: { responseMimeType: 'application/json' }
            });
        } catch (error) {
            navLogger.logWarn(i + 1, 'navigation agent request failed', { error: error.message });
            return {
                success: false,
                tabs: i + 1,
                matchedText: focused.label || focused.text,
                confirmedValue: null,
                error: error.message,
            };
        }
        await new Promise((resolve) => setTimeout(resolve, COOLDOWN_MS / MAX_RPM))

        try {
            const result = JSON.parse(response.text);
            trace.push({
                step: i + 1,
                stage: 'decision',
                action: result.action,
                reason: result.reason,
                focusedLabel,
                tag: focused.tag,
                role: focused.role,
                id: focused.id,
            });
            navLogger.logStep(i + 1, `model decision: ${result.action}`, { reason: result.reason });

            if (result.action === 'click' || result.action === 'enter') {
                if (isButtonLikeControl(focused)) {
                    navLogger.logStep(i + 1, 'pressing Enter on button-like control', { focusedLabel });
                    await page.keyboard.press('Enter');
                    trace.push({
                        step: i + 1,
                        stage: 'result',
                        action: 'enter',
                        focusedLabel,
                        reason: 'pressed Enter on button-like control',
                    });
                    const actionMessage = `Action ${i + 1}: pressed Enter on ${focusedLabel || 'control'} [${focused.tag || 'element'}]`;
                    liveFeed.push(actionMessage);
                    emitLiveFeed(onLiveFeed, actionMessage);
                    return {
                        success: true,
                        tabs: i + 1,
                        matchedText: focused.label || focused.text,
                        confirmedValue: focused.value ?? null,
                        thought: `Pressed Enter on button-like control ${focused.label || focused.text}`,
                        focused,
                        actionType: 'enter',
                        trace,
                        liveFeed,
                        reviewState,
                    };
                }

                if (focused.tag === 'INPUT' || focused.tag === 'TEXTAREA') {
                    if (value) {
                        navLogger.logStep(i + 1, 'typing into input field', { value });
                        const fillResult = await fillFocusedInput(page, focused, value);
                        if (fillResult.success) {
                            navLogger.logStep(i + 1, 'confirmed input value', { confirmedValue: fillResult.confirmedValue });
                            trace.push({
                                step: i + 1,
                                stage: 'result',
                                action: 'type',
                                focusedLabel,
                                reason: `typed value into ${focusedLabel}`,
                            });
                            const actionMessage = `Action ${i + 1}: typed value into ${focusedLabel || 'input'} [${focused.tag || 'element'}]`;
                            liveFeed.push(actionMessage);
                            emitLiveFeed(onLiveFeed, actionMessage);
                            return {
                                success: true,
                                tabs: i + 1,
                                matchedText: focused.label || focused.text,
                                confirmedValue: fillResult.confirmedValue,
                                thought: `Typed value into focused input: ${focused.label || focused.text}`,
                                focused,
                                actionType: 'type',
                                trace,
                                liveFeed,
                                reviewState,
                            };
                        }

                        navLogger.logWarn(i + 1, 'failed to confirm input value after typing');
                        trace.push({
                            step: i + 1,
                            stage: 'result',
                            action: 'type-failed',
                            focusedLabel,
                            reason: 'could not confirm input value after typing',
                        });
                        const actionMessage = `Action ${i + 1}: attempted typing into ${focusedLabel || 'input'} [${focused.tag || 'element'}]`;
                        liveFeed.push(actionMessage);
                        emitLiveFeed(onLiveFeed, actionMessage);
                        return {
                            success: false,
                            tabs: i + 1,
                            matchedText: focused.label || focused.text,
                            confirmedValue: null,
                            thought: 'Attempted to type into input but could not confirm the value',
                            focused,
                            actionType: 'type',
                            trace,
                            liveFeed,
                            reviewState,
                        };
                    }

                    if (focused.type === 'checkbox' || focused.type === 'radio') {
                        const toggleResult = await toggleFocusedCheckbox(page, focused);
                        navLogger.logStep(i + 1, 'toggling checkbox or radio', { checked: toggleResult.checked });
                        trace.push({
                            step: i + 1,
                            stage: 'result',
                            action: 'toggle',
                            focusedLabel,
                            reason: `toggled ${focused.type} control`,
                        });
                        const actionMessage = `Action ${i + 1}: toggled ${focused.type || 'control'} ${focusedLabel || 'control'} [${focused.tag || 'element'}]`;
                        liveFeed.push(actionMessage);
                        emitLiveFeed(onLiveFeed, actionMessage);
                        return {
                            success: toggleResult.success,
                            tabs: i + 1,
                            matchedText: focused.label || focused.text,
                            confirmedValue: toggleResult.checked,
                            thought: `Toggled ${focused.type} control ${focused.label || focused.text}`,
                            focused,
                            actionType: 'toggle',
                            trace,
                            liveFeed,
                            reviewState,
                        };
                    }

                    navLogger.logStep(i + 1, 'focused input field without provided value');
                    trace.push({
                        step: i + 1,
                        stage: 'result',
                        action: 'interact',
                        focusedLabel,
                        reason: 'interacted with focused input field',
                    });
                    const actionMessage = `Action ${i + 1}: interacted with ${focusedLabel || 'input'} [${focused.tag || 'element'}]`;
                    liveFeed.push(actionMessage);
                    emitLiveFeed(onLiveFeed, actionMessage);
                    return {
                        success: true,
                        tabs: i + 1,
                        matchedText: focused.label || focused.text,
                        confirmedValue: focused.value ?? null,
                        thought: `Interacted with focused input field ${focused.label || focused.text}`,
                        focused,
                        actionType: 'interact',
                        trace,
                        liveFeed,
                        reviewState,
                    };
                }

                const clickedControl = await clickFocusedControl(page, focused);
                if (clickedControl.success) {
                    navLogger.logStep(i + 1, 'clicked focused control', { focusedLabel });
                    trace.push({
                        step: i + 1,
                        stage: 'result',
                        action: 'click',
                        focusedLabel,
                        reason: 'clicked focused control directly',
                    });
                    const actionMessage = `Action ${i + 1}: clicked ${focusedLabel || 'control'} [${focused.tag || 'element'}]`;
                    liveFeed.push(actionMessage);
                    emitLiveFeed(onLiveFeed, actionMessage);
                    return {
                        success: true,
                        tabs: i + 1,
                        matchedText: focused.label || focused.text,
                        confirmedValue: focused.value ?? null,
                        thought: `Clicked focused control ${focused.label || focused.text}`,
                        focused,
                        actionType: 'click',
                        trace,
                        liveFeed,
                        reviewState,
                    };
                }

                navLogger.logStep(i + 1, 'pressing Enter on focused control');
                await page.keyboard.press('Enter');
                trace.push({
                    step: i + 1,
                    stage: 'result',
                    action: 'enter',
                    focusedLabel,
                    reason: 'pressed Enter on focused control',
                });
                const actionMessage = `Action ${i + 1}: pressed Enter on ${focusedLabel || 'control'} [${focused.tag || 'element'}]`;
                liveFeed.push(actionMessage);
                emitLiveFeed(onLiveFeed, actionMessage);
                return {
                    success: true,
                    tabs: i + 1,
                    matchedText: focused.label || focused.text,
                    confirmedValue: focused.value ?? null,
                    thought: `Pressed Enter on focused control ${focused.label || focused.text}`,
                    focused,
                    actionType: 'enter',
                    trace,
                    liveFeed,
                    reviewState,
                };
            }

            if (result.action === 'notfound') {
                navLogger.logWarn(i + 1, 'target not found by navigation agent');
                trace.push({
                    step: i + 1,
                    stage: 'result',
                    action: 'notfound',
                    focusedLabel,
                    reason: 'navigation agent did not find target',
                });
                return {
                    success: false,
                    tabs: i + 1,
                    matchedText: null,
                    thought: `Navigation agent did not find target after evaluating focused element ${focused.label || focused.text}`,
                    trace,
                    liveFeed,
                    reviewState,
                };
            }
        } catch {
            console.error('   Failed to parse nav response:', response.text);
            trace.push({
                step: i + 1,
                stage: 'result',
                action: 'parse-error',
                focusedLabel,
                reason: 'failed to parse navigation model response',
            });
            return {
                success: false,
                tabs: i + 1,
                matchedText: focused.label || focused.text,
                thought: 'Failed to parse navigation model response',
                trace,
                liveFeed,
                reviewState,
            };
        }

        trace.push({
            step: i + 1,
            stage: 'advance',
            action: 'tab',
            focusedLabel,
            reason: 'pressed Tab to move to the next element',
        });
        await page.keyboard.press('Tab');
        await page.waitForTimeout(100);
    }

    trace.push({
        step: maxTabs,
        stage: 'result',
        action: 'max-tabs',
        focusedLabel: null,
        reason: 'reached the maximum tab attempts without finding the target',
    });
    return {
        success: false,
        tabs: maxTabs,
        matchedText: null,
        thought: 'Reached the maximum tab attempts without finding the target',
        trace,
        liveFeed,
        reviewState,
    };
}
