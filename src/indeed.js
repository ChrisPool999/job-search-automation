import { MAX_RPM, COOLDOWN_MS, urlQuery, client, DAYS_POSTED } from './const.js';
import fs from 'fs'
import { shouldIApply } from './gemini.js';
import { exit } from 'process';

function scoreColor(score, text) {
    if (score >= 8) {
        return 'green'
    }
    else if (score >= 5) {
        return 'yellow'
    } else {
        return 'red'
    }
}

import savedData from './data/mock_data.json' with { type: 'json' }
(async () => {

    
    // const run = await client.actor("MXLpngmVpE8WTESQr").call(urlQuery);
    // const { items } = await client.dataset(run.defaultDatasetId).listItems();

    // mock data
    let items = savedData 

    let results = []
    for (const [i, job] of items.entries()) {

        // analyze
        const jobInfo = "job title: " + job.title + " company name: " + job.companyName + " description: " + job.descriptionText

        let analysis
        for (let i = 0; i < 5; i++) {
            try {
                analysis = await shouldIApply(jobInfo)  
                break
            } catch (err) {
                await new Promise((resolve) => setTimeout(resolve, 3000))
                if (i === 4) {
                    throw err
                }
                console.log(`gemini error. retrying. attempt ${i+1} / 5\n`)
            }
        }

        results.push( {job, analysis } )

        console.clear()
        console.log(i + "/" + items.length + " completed")
        await new Promise((resolve) => setTimeout(resolve, COOLDOWN_MS / MAX_RPM))
    };
    console.clear()
    console.log("COMPLETED " + items.length + " jobs \n")
    
    results.sort((a, b) => b.analysis.score - a.analysis.score);

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
        </head>
        <body>
        ${results.map(({ job, analysis }) => `
            <div class="job my-5">
                <div class="score" style="color:${scoreColor(analysis.score)}">
                    Score: ${analysis.score}/10 Posted: ${job.age}
                </div>
                <p>${job.title}</p>
                <p>${job.companyName}</p>
                <div>YOE: ${analysis.yoe}</div>
                <div style="color:${scoreColor(analysis.score)}">Reason: ${analysis.reason}</div>
                <a class="text-blue-300 underline" href=${job.jobUrl}>Job Posting<a>
            </div>
        `).join('')}
        </body>
        </html>
    `;

    fs.writeFileSync('./index.html', html)
})(); 