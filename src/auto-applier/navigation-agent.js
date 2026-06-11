import { GoogleGenAI } from '@google/genai';
import { MAX_RPM, COOLDOWN_MS } from '../job-analyzer/config.js';

const ai = new GoogleGenAI({});

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

export async function navigateToTarget(page, targetText, value = null, maxTabs = 50) {
    console.log(`\nNav agent searching for: "${targetText}"`);

    for (let i = 0; i < maxTabs; i++) {
        const focused = await getFocusedElementInfo(page);
        console.log(`   Tab ${i + 1}: "${focused.label || focused.text || focused.tag}"`);

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
            console.log(`   → ${result.action}: ${result.reason}`);

            if (result.action === 'click') {
                if (focused.tag === 'INPUT' || focused.tag === 'TEXTAREA') {
                    // it's a field, type into it
                    if (value) {
                        await page.keyboard.type(value);
                    }
                } else {
                    // it's a button, press Enter
                    await page.keyboard.press('Enter');
                }
                return { success: true, tabs: i + 1, matchedText: focused.label || focused.text };
            }

            if (result.action === 'notfound') {
                return { success: false, tabs: i + 1, matchedText: null };
            }

        } catch {
            console.error('   Failed to parse nav response:', response.text);
        }

        await page.keyboard.press('Tab');
        await page.waitForTimeout(100);
    }

    console.log(`   ❌ hit max tabs (${maxTabs}), target not found`);
    return { success: false, tabs: maxTabs, matchedText: null };
}