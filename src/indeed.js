import { ApifyClient } from 'apify-client';
import "dotenv/config"
import { APIFY_API_KEY, MAX_RPM, COOLDOWN_MS } from './const.js';

const client = new ApifyClient({
    token: `${APIFY_API_KEY}`,
});

const jrSWE1day = {
    "country": "us",
    "query": "junior software engineer",
    "location": "California",
    "maxRows": 50,
    "sort": "date",
    "fromDays": "1",
    "maxRowsPerUrl": 3,
    "enableUniqueJobs": true,
    "includeSimilarJobs": true
};

const jrSWE2day = {
    "country": "us",
    "query": "junior software engineer",
    "location": "California",
    "maxRows": 100,
    "sort": "date",
    "fromDays": "2",
    "maxRowsPerUrl": 3,
    "enableUniqueJobs": true,
    "includeSimilarJobs": true
};

import { shouldIApply } from './gemini.js';
import savedData from './data/mock.json' with { type: 'json' }

function printCompletedJobs(jobs) {
    const size = jobs.length

    console.clear()
    console.log(size ? "Current jobs analyzed!\n" : "No results yet!\n")
    for (let i = size - 1; i >= 0; i--) {
        console.log(`match score? ${jobs[i].match_score}\n`)
        console.log(`apply? ${jobs[i].worth_applying ? "YES" : "NO"}` + `        YOE: ${jobs[i].yoe_logic}\n`)
        console.log(`role type? ${jobs[i].role_type}\n`)
        console.log(`reason?: ${jobs[i].reason}\n`)
        console.log("\n-----------------------------------------\n")
    }
}

(async () => {
    // const scrapMethod = jrSWE2day
    // const run = await client.actor("MXLpngmVpE8WTESQr").call(scrapMethod);
    // const { items } = await client.dataset(run.defaultDatasetId).listItems();

    let items = savedData.splice(0, 5)

    let results = []
    for (const [i, item] of items.entries()) {

        // analyze
        const jobInfo = "job title: " + item.title + " company name: " + item.companyName + " description: " + item.descriptionText
        const value = await shouldIApply(jobInfo)  
        results.push(value)
        printCompletedJobs(results)

        await new Promise((resolve) => setTimeout(resolve, COOLDOWN_MS / MAX_RPM))
    };

    console.clear()
    console.log("COMPLETE\n")
    results.sort((a, b) => b.match_score - a.match_score);

    results.forEach((item) => {
        console.log(`Score: ${item.match_score} | Role: ${item.role_type}\n`);
        console.log(item.yoe_logic + "\n")
        console.log(item.reason+ "\n");
        console.log("-------------------\n");
    });    
})(); 