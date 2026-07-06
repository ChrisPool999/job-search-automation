import { job, MAX_RPM, COOLDOWN_MS, client, RESUME_CUTOFF_SCORE } from './config.js';
import { generateResumeFiles } from '../resume-builder/resume-generator.js';
import fs from 'fs'
import { exit } from 'process';
import { GoogleGenAI } from "@google/genai";

function getJobUXColor(score) {
    if (score >= 8) return 'green'
    if (score >= 5) return 'yellow'
    return 'red'
}

async function retryFunction(fn, ...args) {
    for (let i = 0; i < 5; i++) {
        try {
            return await fn(...args)  
        } catch (err) {
            if (i === 4) {
                throw err
            }
            console.log(`error. retrying. attempt ${i+1} / 5\n`)
            await new Promise((resolve) => setTimeout(resolve, 3000))
        }
    }
}

async function getIndeedJobs() {
    let data  = []
    const queries = job.returnQueries()
    for (const query of queries) {
        const run = await client.actor("MXLpngmVpE8WTESQr").call(query)
        const { items } = await client.dataset(run.defaultDatasetId).listItems()
        data.push(...items)
    }
    return data
}

async function createGeminiFilter() {
    const ai = new GoogleGenAI({});

    return async function(jobInfo) {
        const contents = job.SYSTEM_PROMPT + " job description: " + jobInfo

        const response = await ai.models.generateContent({
          model: "gemini-3.1-flash-lite",
          contents: contents,
          config: {
              responseMimeType: "application/json",
          }
        });
        return JSON.parse(response.text)
    }
}

async function analysisJobs(data) {
    let results = []
    const seen = new Set()
    const geminiFilter = await createGeminiFilter()

    for (const [i, job] of data.entries()) {
        if (seen.has(job.jobKey)) {
            continue
        }
        seen.add(job.jobKey)

        const jobInfo = "job title: " + job.title + " company name: " + job.companyName + " description: " + job.descriptionText
        let analysis = await retryFunction(geminiFilter, jobInfo)  

        results.push( {job, analysis } )

        console.clear()
        console.log(i + "/" + data.length + " completed")
        await new Promise((resolve) => setTimeout(resolve, COOLDOWN_MS / MAX_RPM))
    };

    console.clear()
    console.log("COMPLETED " + data.length + " jobs \n")
    
    results.sort((a, b) => b.analysis.score - a.analysis.score)
    return results   
}


function createHTMLFile(results) {
    const date = new Date()
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: monospace; background: #1e1e1e; color: #ccc; padding: 20px; }
                .job { border: 1px solid #444; margin-bottom: 20px; padding: 15px; border-radius: 6px; }
                .score { font-size: 1.5em; font-weight: bold; }
            </style>
            <script src="https://cdn.tailwindcss.com"></script>
            <script src="./resume-tailor.js"></script>
        </head>
        <body>
        <h1 class="font-bold">Search completed: ${date.toLocaleString()}</h1>
        ${results.map(({ job, analysis }) => `
            <div class="job my-5">
                <div class="score" style="color:${getJobUXColor(analysis.score)}">
                    Score: ${analysis.score}/10 Posted: ${job.age}
                </div>
                <p>${job.title}</p>
                <p>${job.companyName}</p>
                <div>YOE: ${analysis.yoe}</div>
                <div style="color:${getJobUXColor(analysis.score)}">Reason: ${analysis.reason}</div>
                <a class="text-blue-300 underline" href=${job.jobUrl}>Job Posting<a>
                <a class="text-blue-300 underline" href="http://localhost:3001/resume/${encodeURIComponent(job.jobKey)}" target="_blank">Download Resume</a>
            </div>
        `).join('')}
        </body>
        </html>
    `
    const filename = "./build/" + (date.getMonth() + 1) + "-" + date.getDate() + ".html"
    fs.writeFileSync(filename, html)
}

async function main() {
    let indeedJobs  = await getIndeedJobs()
    let results = await analysisJobs(indeedJobs)
    await generateResumeFiles(results)
    createHTMLFile(results)
}

main()