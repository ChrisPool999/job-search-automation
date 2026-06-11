import { chromium } from 'playwright';
import { LINK_OPEN_DELAY_MS, COOLDOWN_MS, MAX_RPM } from './config.js';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({});

export async function openJobLinks(results) {
    if (!Array.isArray(results) || results.length === 0) {
        console.log('No job links were provided to open.');
        return;
    }

    console.log(`Opening ${results.length} job links in Playwright (headless: false), reusing a browser instance...`);

    const selectors = [];
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();

    for (const [index, { job, analysis }] of results.entries()) {
        const url = job.jobUrl;
        if (!url) {
            console.log(`Skipping job with missing URL: ${job.title} @ ${job.companyName}`);
            continue;
        }

        console.log(`[${index + 1}/${results.length}] ${analysis.score}/10 - ${job.title} @ ${job.companyName}`);

        try {
            const page = await context.newPage();
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
            // capture full HTML
            const html = await page.content();

            const prompt = `Find the Easy Apply or Apply on company site button selector in this HTML.\nReturn JSON only: { "easyApply": "css selector or text" }\n\nHTML: ${html}`;

            let selectorResult = null;
            try {
                const response = await ai.models.generateContent({
                    model: 'gemini-3.1-flash-lite',
                    contents: prompt,
                    config: { responseMimeType: 'application/json' }
                });
                selectorResult = JSON.parse(response.text);
                await new Promise((resolve) => setTimeout(resolve, 2 * COOLDOWN_MS / MAX_RPM));
            } catch (err) {
                console.error('Failed to get/parse easyApply selector from Gemini for', url, err);
            }

            console.log('Easy Apply selector result for', url, selectorResult);
            const result = { easyApply: selectorResult };
            selectors.push({ job, selector: result });

            const clickTarget = async (target) => {
                if (!target) return false;
                try {
                    await page.locator(target).click({ timeout: 10000 });
                    return true;
                } catch (clickError) {
                    try {
                        await page.getByText(target).click({ timeout: 10000 });
                        return true;
                    } catch (textClickError) {
                        console.error(`Failed to click selector/text on ${url}:`, target, clickError);
                        return false;
                    }
                }
            };

            if (selectorResult && selectorResult.easyApply) {
                const selector = selectorResult.easyApply;
                const clicked = await clickTarget(selector);
                if (clicked) {
                    console.log(`Clicked Easy Apply on ${url}:`, selector);
                    await page.waitForTimeout(800);

                    const updatedHtml = await page.content();
                    const loginPrompt = `Find the Login with Google button selector in this HTML.\nReturn JSON only: { "loginWithGoogle": "css selector or text" }\n\nHTML: ${updatedHtml}`;

                    let googleSelectorResult = null;
                    try {
                        const response = await ai.models.generateContent({
                            model: 'gemini-3.1-flash-lite',
                            contents: loginPrompt,
                            config: { responseMimeType: 'application/json' }
                        });
                        googleSelectorResult = JSON.parse(response.text);
                        await new Promise((resolve) => setTimeout(resolve, 2 * COOLDOWN_MS / MAX_RPM));
                    } catch (err) {
                        console.error('Failed to get/parse Login with Google selector from Gemini for', url, err);
                    }

                    console.log('Login with Google selector result for', url, googleSelectorResult);
                    result.loginWithGoogle = googleSelectorResult;

                    if (googleSelectorResult && googleSelectorResult.loginWithGoogle) {
                        const loginSelector = googleSelectorResult.loginWithGoogle;
                        const clickedGoogle = await clickTarget(loginSelector);
                        if (clickedGoogle) {
                            console.log(`Clicked Login with Google on ${url}:`, loginSelector);
                        } else {
                            console.log(`Login with Google selector present but could not click: ${loginSelector}`);
                        }
                    }
                }
            } else {
                console.log(`No Easy Apply selector returned for ${url}, skipping click.`);
            }

            await new Promise((r) => setTimeout(r, LINK_OPEN_DELAY_MS));
        } catch (err) {
            console.error(`Error opening ${url}:`, err);
        }
    }

    console.log('Completed opening and analyzing all job links. Browser instances and pages remain open.');
    return selectors;
}
