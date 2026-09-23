import { LOCATION, JOB, MAX_RPM, COOLDOWN_MS } from './config.js';
import fs from 'fs'
import { GoogleGenAI } from "@google/genai";
import { ApifyClient } from 'apify-client';

const SEEN_JOBS_FILE = './seen-jobs.json'
const PERSISTED_SCORE_CUTOFF = 60

function getPastJobs() {
    try {
        const storedJobs = JSON.parse(fs.readFileSync(SEEN_JOBS_FILE, 'utf8'))
        return new Set(Array.isArray(storedJobs) ? storedJobs : [])
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn(`Could not read ${SEEN_JOBS_FILE}; starting with no persisted jobs.`)
        }
        return new Set()
    }
}

function savePastJobs(seen) {
    const temporaryFile = `${SEEN_JOBS_FILE}.tmp`
    fs.writeFileSync(temporaryFile, JSON.stringify([...seen], null, 2) + '\n')
    fs.renameSync(temporaryFile, SEEN_JOBS_FILE)
}

function getJobUXColor(score) {
    if (score >= 80) return 'green'
    if (score >= 60) return 'yellow'
    if (score >= 40) return 'orange'
    return 'red'
}

async function retryFunction(fn, ...args) {
    const RETRIES = 10
    for (let i = 0; i < RETRIES; i++) {
        try {
            return await fn(...args)  
        } catch (err) {
            if (i === 9) {
                throw err
            }
            await new Promise((resolve) => setTimeout(resolve, 3000))
        }
    }
}

function isApifyQuoteError(err) {
    return err.statusCode === 403 && err.type === "platform-feature-disabled"
}

function isGeminiQuoteError(err) {
    return err.statusCode === 429 && err.type === err?.error?.status === "RESOURCE_EXHAUSTED"
}

async function useApiKeys(i, apiKeysSize, fn) {
    while (i <= apiKeysSize) {
        try {
            await fn(i)
            break 
        } catch (err) {
            if (isApifyQuoteError(err)) {
                console.log(`API key ${i} / ${apiKeysSize} exhausted. Switching to next API key.`)
                i++
            } else {
                throw err
            }
        } 
    }
    if (i > apiKeysSize) {
        throw new Error("All API keys exhausted. Please update the .env file with a new APIFY_API_KEY and restart the script.")
    }
    return i
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getIndeedJobs() {
    const apiKeysSize = process.env.APIFY_API_KEY_SIZE

    const queries = JOB.returnQueries()
    let data  = []
    let i = 1
    for (const query of queries) {
        i = await useApiKeys(i, apiKeysSize, async (j) => {
                const TOKEN = process.env[`APIFY_API_KEY${j}`]
                const CLIENT = new ApifyClient({token: TOKEN});
                const run = await CLIENT.actor("MXLpngmVpE8WTESQr").call(query)
                const { items } = await CLIENT.dataset(run.defaultDatasetId).listItems()
                data.push(...items) 
            })
    }
    return data
}

function removeDuplicateJobs(data, persistentSeen) {
    const seen = new Set(persistentSeen)

    for (let i = 0; i < data.length;) {
        if (seen.has(data[i].jobKey)) {
            data[i] = data[data.length - 1]
            data.pop()
            continue
        }

        seen.add(data[i].jobKey)
        i++
    }
}

async function createGeminiFilter(apiKeyIndex = 1) {
    const ai = new GoogleGenAI({ apiKey: process.env[`GEMINI_API_KEY${apiKeyIndex}`] });

    return async function(jobInfo) {
        const contents = JOB.systemPrompt + " job description: " + jobInfo

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

async function createAnalysisWorker(data, results, seen, i) {
    let GEMINI_FILTER = null
    try {
        GEMINI_FILTER = await createGeminiFilter(i)
    } catch (err) {
        if (isGeminiQuoteError(err)) {
            return 
        } 
        throw err
    }

    let job = null
    try {
        while (data.length > 0) {
            job = data.pop()

            const jobInfo = "job title: " + job.title + " company name: " + job.companyName + " description: " + job.descriptionText
            let analysis = await retryFunction(GEMINI_FILTER, jobInfo)  

            results.push( {job, analysis } )
            if (analysis.score >= PERSISTED_SCORE_CUTOFF) {
                seen.add(job.jobKey)
                savePastJobs(seen)
            }

            console.log(data.length + " jobs remaining")

            await new Promise((resolve) => setTimeout(resolve, COOLDOWN_MS / MAX_RPM))
        }
    } catch (err) {
        data.push(job)
        return
    }
}

async function analysisJobs(data) {
    let results = []
    const seen = getPastJobs()
    removeDuplicateJobs(data, seen)
    console.log("unique jobs to analyze: " + data.length)
    const UNIQUE_JOBS = data.length

    while (true) {
        const geminiApiKeysSize = Number(process.env.GEMINI_API_KEY_SIZE)
        const promises = []
        for (let i = 1; i <= geminiApiKeysSize; i++) {
            promises.push(createAnalysisWorker(data, results, seen, i))
        }
        
        await Promise.all(promises)
        // race condition check where failed jobs get added back in, after breaking out of async loop
        if (data.length === 0) {
            break
        }
    }

    console.clear()
    console.log("COMPLETED " + data.length + " jobs \n")
    if (results.length !== UNIQUE_JOBS) {
        console.log(`${UNIQUE_JOBS - results.length} jobs were lost`)
    }

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
        <h1 class="font-bold">Job: ${JOB.name} Location: ${LOCATION}</h1>
        <h1 class="font-bold">Jobs Analyzed: ${results.length}</h1>
        ${results.map(({ job, analysis }) => `
            <div class="job my-5">
                <div class="score" style="color:${getJobUXColor(analysis.score)}">
                    Score: ${analysis.score}/100 Posted: ${job.age}
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
    const filename = "./output/" + (date.getMonth() + 1) + "-" + date.getDate() + "-" + JOB.name + "-" + LOCATION + "-" + ".html"
    fs.writeFileSync(filename, html)
}

async function main() {
    let indeedJobs
    if (process.argv[2] === "test") {
        let raw = fs.readFileSync('./tests/mock-data.json')
        indeedJobs = JSON.parse(raw)
    } else {
        indeedJobs = await getIndeedJobs()
    }

    let results = await analysisJobs(indeedJobs)
    createHTMLFile(results)
}

main()