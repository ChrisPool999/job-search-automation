import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { exec } from 'child_process';
import { resumeBody, resumeCSS, buildPrompt } from './config.js';
import { GoogleGenAI } from "@google/genai";
import { MAX_RPM, COOLDOWN_MS } from '../job-analyzer/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUILD_DIR = path.resolve(__dirname, '../../build');

function sanitizeFilename(value) {
    return value
        .replace(/[<>:\"/\\|?*\x00-\x1F]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase() || 'resume';
}

const ai = new GoogleGenAI({});

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function tailorBody(html, prompt, jobInfo) {
  const contents = `${prompt}\n\nHTML:\n${html}\n\nJob Info:\n${jobInfo}`;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-lite",
    contents: contents,
    config: { responseMimeType: "text/plain" }
  });

  // Respect existing rate limiter cadence
  await sleep(COOLDOWN_MS / MAX_RPM);

  return response.text;
}

async function buildResumeHTML(jobInfo) {
    const tailoredBody = await tailorBody(resumeBody, buildPrompt, jobInfo);
    return `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8"/>
            <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
            <title>Christopher Pool - Resume</title>
          ${resumeCSS}
          </head>
          <body>
            <div class="page">
              ${tailoredBody}
            </div>
          </body>
        </html>
    `
}

export async function generateResume(job) {
    const dateSuffix = new Date().toISOString().slice(0, 10);
    const outputDir = path.join(BUILD_DIR, `${dateSuffix}-resumes`);
    fs.mkdirSync(outputDir, { recursive: true });

    const safeName = sanitizeFilename((job.companyName + job.title).slice(0, 50));
    const outputPath = path.join(outputDir, `${safeName}.pdf`);

    const jobInfo = "job title: " + job.title + " company name: " + job.companyName + " description: " + job.descriptionText + " location: " + job.location
    const html = await buildResumeHTML(jobInfo);

    let browser;
    try {
        // launches a headless Chrome browser in the background
        browser = await chromium.launch()
        
        // creates a new browser tab
        const page = await browser.newPage()
        
        // injects your HTML string into the tab
        // waitUntil: 'networkidle' waits until there are no more network requests
        // important if your HTML loads external fonts or stylesheets
        await page.setContent(html, { waitUntil: 'networkidle' })
        
        // renders the page to a PDF and saves it to disk
        // format: 'Letter' is standard US 8.5x11 paper
        // printBackground: true includes background colors/images from your CSS
        // margin sets the white space around the content
        await page.pdf({
            path: outputPath,
            format: 'Letter',
            printBackground: true,
            margin: {
                top: '0.5in',
                bottom: '0.5in',
                left: '0.5in',
                right: '0.5in'
            }
        });
        
        console.log(`Saved PDF to ${outputPath}`);
        return outputPath;
        
    } catch (err) {
        console.error('Failed to generate PDF:', err);
        throw err;
    } finally {
        // always close the browser even if something throws
        // otherwise Chrome processes pile up in the background
        if (browser) await browser.close();
    }
}