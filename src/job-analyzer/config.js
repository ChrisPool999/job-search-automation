import { ApifyClient } from 'apify-client';
import "dotenv/config"

export const MAX_RPM = 12
export const COOLDOWN_MS = 65 * 1000
export const LINK_OPEN_DELAY_MS = 10 * 1000

export const client = new ApifyClient({
    token: process.env.APIFY_API_KEY,
});

// lowest score that tailored resumes will be generated for (1-10)
export const RESUME_CUTOFF_SCORE = 5

// job options: { SWE | regularJob | LosAngelesRegular }
export { SWE as job } 

// search options
const DAYS_POSTED = "3"
const MAX_ROWS = 30

// job options
const SWE = {
    jobQueries : [
        "junior software engineer",
        "junior software developer",
        "associate software developer",
        "jr developer"
    ],

    SYSTEM_PROMPT : `
        I'm a new grad looking to find my first software engineering job. I have 0 years of professional experience and no internships. 
        I'll show you my resume, and I need you to use your best judgement on what's worth applying to, prioritizing what I'll actually hear back from, and determining it's the kind of job im looking for, eg entry level dev.
        The main thing goal is, i want to avoid jobs that I reasonably am unqualified for, and not worth applying to. secondly, prioritizing the job postints ill most likely hear back from.
        To do this, compare my resume to the job description and requirements, and use your best judgement to determine whether I meet the qualifications, and how well I match the job.

        Some things to watch out for: 
        - internships are commonly for active students; which I am not. If it's internship, decern whether it accepts new grads, or only current students.
        - jobs requiring security clearance typically are willing hire those without one. But some jobs do require a security clearance before, so verify if it comes up. 

        Job posting might say like 1 year experience, but try to discern whether it comes across as a hard requirement, or maybe not, eg if it says junior / entry level position. 

        secondly I want you to assign a score to the job based on 1-10. Give any job im unqualified for a 0. Give it a 1-9 based on what we've talked about. 
        1 might be a new grad role thats a very hard reach, but possible. 5 might be something reasonable but not with my tech stack. 10 would be really close tech stack, and a junior full stack position.

        OUTPUT (valid JSON only, no markdown, no preamble):
        {
          "score": number (0 or 1-10),
          "yoe": "exact years of professional experience the job is asking for.",
          "reason": "one blunt sentence explaining the score. make it concise, without fluff. "
        }
        `.trim(),

    returnQueries() {
        let queries = []
        for (const job of this.jobQueries) {
            queries.push({
                "country": "us",
                "query": job,
                "location": "California",
                "maxRows": MAX_ROWS,
                "sort": "date",
                "fromDays": DAYS_POSTED,
                "enableUniqueJobs": true,
                "includeSimilarJobs": true            
            })
        }
        return queries
    }
}

const FresnoRegular = {
    jobQueries : [
        "office assistant",
        "data entry",
        "IT support",
        "help desk",
        "technical support",
        "receptionist",
        "administrative assistant",
        "security guard",
        "customer success",
        "operations coordinator"
    ],

    SYSTEM_PROMPT : `
        I'm a recent CS grad looking for short-term work while pursuing software engineering roles. 
        I'm targeting white-collar, low-physical-labor positions I can work on a computer — 
        office assistant, data entry, IT support, help desk, receptionist, admin, security, operations. 
        I have a CS degree and roughly 1 year of general work experience. I'm based in Fresno, CA and available full-time. 
        Score based on fit for someone overqualified but needs income fast — prioritize roles that are easy to get, 
        pay above $16/hr, and don't require specialized certifications or years of experience.

        OUTPUT (valid JSON only, no markdown, no preamble):
        {
          "score": number (0 or 1-10),
          "yoe": "exact years of professional experience the job is asking for.",
          "reason": "one blunt sentence explaining the score. make it concise, without fluff. "
        }
        `.trim(),

    returnQueries() {
        let queries = []
        for (const job of this.jobQueries) {
            queries.push({
                "country": "us",
                "query": job,
                "location": "Fresno, CA",
                "maxRows": MAX_ROWS,
                "sort": "date",
                "fromDays": DAYS_POSTED,
                "enableUniqueJobs": true,
                "includeSimilarJobs": true            
            })
        }
        return queries
    }
}

const LosAngelesRegular = {
    jobQueries : [
        "office assistant",
        "data entry",
        "IT support",
        "help desk",
        "technical support",
        "receptionist",
        "administrative assistant",
        "security guard",
        "customer success",
        "operations coordinator",
        "entry level HR",
        "HR coordinator",
        "payroll specialist",
        "recruiting coordinator",
        "benefits administrator",
        "account coordinator",
        "junior analyst",
        "business analyst entry level",
        "project coordinator",
        "customer success associate"
    ],

    SYSTEM_PROMPT : `
        I'm a recent CS grad looking for stable income while pursuing software engineering roles. I have around 1 year general customer service experience.
        I prefer white-collar roles I can grow in — IT support, help desk, HR, payroll, recruiting, 
        operations, or any entry-level role where a CS degree is an advantage. The biggest thing you must is give any 
        job im unqualified for, (basically dont meet job posting requirements) a 0, or basically exclude any I can't apply to 
        (eg requires 3 years exp, or a degree in healthcare, etc)

        Scoring priority:
        - High pay ($20+/hr) and career growth potential = 8-10
        - Easy to get, decent pay ($16-20/hr) = 5-7
        - Low pay or dead end = 1-4
        - Requires specialized certifications or years of experience I dont have. = 0

        OUTPUT (valid JSON only, no markdown, no preamble):
        {
          "score": number (0 or 1-10),
          "yoe": "exact years of professional experience the job is asking for.",
          "reason": "one blunt sentence explaining the score."
        }`.trim(),

    returnQueries() {
        let queries = []
        for (const job of this.jobQueries) {
            queries.push({
                "country": "us",
                "query": job,
                "location": "Los Angeles County, CA",
                "maxRows": MAX_ROWS,
                "sort": "date",
                "fromDays": DAYS_POSTED,
                "enableUniqueJobs": true,
                "includeSimilarJobs": true            
            })
        }
        return queries
    }
}