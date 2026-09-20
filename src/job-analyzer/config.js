import "dotenv/config"

const resume = `
Christopher Pool
Education
Bachelor of Science, Computer Science                                                     Graduated: Dec 2025
California State University East Bay - Hayward, CA  

Experience	
 
Software Engineer & Data Trainer                                                                 Dec 2025 – Present  
AI Training Data Platform (Contract)                     
Conducted code review across Dockerized codebases in React, TypeScript, and C++, identifying bugs, logic errors, and performance inefficiencies
Resolved bugs and optimized code for correctness and readability in sensitive domains such as fintech systems handling ACH transfers
Wrote unit and end-to-end tests using Jest and Node.js to validate fixes and verify behavior across affected code paths

Projects	
 
Full-Stack Ecommerce Site - GitHub | Live Demo                                       Jan 2026 -  Feb 2026
React  |  Next.js  |  Node.js  |  Express  |  TypeScript  |  PostgreSQL  |  Docker  |  GitHub Actions
Built React/TypeScript frontend with server-side rendering via Next.js supporting product catalog, cart, and checkout flows 
Designed REST API in Node.js/Express handling authentication, order processing, and product management backed by PostgreSQL 
Containerized full application stack with Docker and automated test and deployment pipeline via GitHub Actions CI/CD 

LLM Job Application Pipeline - GitHub                                                                        Feb 2026
Node.js  |  Python  |  Claude API  |  Gemini API  |  Apify
Built end-to-end job sourcing pipeline scraping 100+ listings daily via Apify, deduplicating results and persisting structured output to a shared JSON store
Integrated Gemini API to score and filter job listings against a candidate profile, reducing manual review to only highly qualified matches above a configurable threshold

Programming Languages: JavaScript, TypeScript, Python, C++, C#                                                                    Frameworks & Libraries: React, Next.js, Node.js, Express, .NET, Jest                                                                  Databases: PostgreSQL, SQL, Prisma ORM                                                                                                                                                                                                                                                                                                                                                                   Tools & Infrastructure: Git, Docker, GitHub Actions, CI/CD, Linux, Vercel                                                                                       

`

export const RESUME_CUTOFF_SCORE = 5

// Rate limiting and cooldowns
export const MAX_RPM = 12
export const COOLDOWN_MS = 65 * 1000
export const LINK_OPEN_DELAY_MS = 10 * 1000

const LOCATIONS = {
    SD:     "San Diego, CA",
    LA:     "Los Angeles County, CA",
    BAY:    "San Francisco Bay Area, CA",
    FRESNO: "Fresno, CA",
    CA:     "California",
}

export const JOB_OPTIONS = {
    SWE: {
        name: "SWE",
        jobQueries: [
            // "junior software engineer",
            "junior software developer",
            "associate software developer",
            "jr developer",
            "entry level software engineer",
            "entry level software developer",
            "junior full stack developer",
            "junior front end developer",
            "junior backend developer",
            "junior web developer",
            "software developer I",
            // "software engineer I",
            // "full stack developer I",
            // "front end developer I",
            // "backend developer I",
            // "web developer I",
        ],
        systemPrompt: `
            I'm a new grad (BS Computer Science, Dec 2025) looking for my first full-time software engineering job. I have roughly 9 months of experience in software development.

            I need you to assign score to each job posting based on how well it matches my qualifications and experience, basically how likely I am to be considered for the role.

            Some examples: 
            - any staff role or senior role is a hard fail, so score 0.
            - any role that requires 2+ years of experience is a hard fail, so score 0.
            - prioritize roles that use my tech stack since obviously I'm more likely to be considered for those.

            resume:${resume}

            OUTPUT (valid JSON only, no markdown, no preamble):
            {
              "score": number (0-100),
              "yoe": "exact years of professional experience the job is asking for",
              "reason": "one blunt sentence explaining the score — say whether the gate or the stack match drove it. no fluff."
            }`.trim(),
        },




    CS_ADJACENT: {
        name: "CS Adjacent",
        jobQueries: [
            // High priority — cyber/security path
            "junior cybersecurity analyst",
            "SOC analyst",
            "information security analyst",
            "systems administrator entry level",
            "network technician",

            // Strong path — infrastructure leads to cyber
            "DevOps engineer entry level",
            "cloud support engineer",
            "QA analyst",
            "QA tester",

            // Mid tier — decent pay, some career path
            "IT support",
            "IT technician",
            "technical support",

            // Lower priority — high volume, lower pay ceiling
            "help desk",
            "service desk analyst",
            "desktop support technician",
            "desktop support",

        ],

        systemPrompt: `
            I'm a recent CS grad (about 9 months out) looking for entry-level IT/technical roles across my field — IT support, help desk, technical support, QA, cybersecurity, systems administration, networking, or any other CS-relevant entry-level role, even if it's not in the search list above.

            I need you to assign score to each job posting based on how well it matches my qualifications and experience, basically how likely I am to be considered for the role.                                                                  

            I also want you to give higher score for jobs with high pay or good growth potential, e.g system admin is more likely to lead to a career path than help desk, so it should score higher even if the pay is similar.
            That being said, sysadmin is also typically higher paid as well, so consider both.

            Basically it's your job to assign a score based on a mix of how likely I am to be considered for the role and how good the role is in terms of pay and growth potential.
            That being said, even if a job has very great pay, it shouldn't matter if im not qualified for it, so consider both.

            OUTPUT (valid JSON only, no markdown, no preamble):
            {
              "score": number (0-100),
              "yoe": "exact years of professional experience the job is asking for",
              "reason": "one blunt sentence explaining the score — say whether it was the gate or the pay tier that drove it. no fluff."
            }
            `.trim(),
            },




    DEGREE_UNRELATED: {
        name: "Degree Unrelated",
        jobQueries: [
            "entry level HR", "HR coordinator", "payroll specialist",
            "recruiting coordinator", "benefits administrator", "account coordinator",
            "junior analyst", "business analyst entry level", "project coordinator",
            "customer success associate", "IT support", "help desk",
            "technical support", "operations coordinator",
            "entry level HR", "HR coordinator", "recruiting coordinator", "benefits administrator",
            "account coordinator", "junior analyst", "business analyst entry level", "project coordinator",
            "operations coordinator", "customer success associate",
        ],
        systemPrompt: `
            I have a CS degree and about 1 year of general work experience (customer service / loan processing). I'm looking for corporate/office-track roles where the requirement is "a bachelor's degree" of any kind — not specifically CS — with a real career ladder attached: HR, recruiting, operations, business/junior analyst, project coordination, and similar. This is not a technical job search; exclude any IT/SWE-specific considerations.

            I'm targeting roles that pay at least $60k/year (or the hourly equivalent, roughly $29/hr+) and have a visible path upward — not a dead-end entry title with no next step. A posting that reads as a long-term individual-contributor role capped low, with no mention of growth, promotion path, or "coordinator → specialist → manager"-style progression, should score lower even if the pay itself is acceptable.

            Give any job I'm unqualified for a 0. That includes:
            - Requires a specific unrelated degree (nursing, accounting/CPA-track, education, etc.) rather than "a bachelor's degree" generically.
            - Requires 2+ years of directly relevant experience.
            - Requires an industry certification or license I don't hold (PHR, SHRM-CP, etc.) as a hard requirement.
            - Pay is clearly well under $60k/year with no stated growth path.

            Otherwise score 1-10:
            - 8-10: bachelor's degree required/preferred with no specific field, pay meets or exceeds $60k, clear growth trajectory mentioned or implied by title ladder (e.g. "HR Coordinator" at a company with a visible HR org).
            - 5-7: meets the degree and pay bar but growth path is unclear or unstated.
            - 1-4: technically meets the bare minimum but pay is below target or role reads as a ceiling position.
            - 0: unqualified per above.

            OUTPUT (valid JSON only, no markdown, no preamble):
            {
              "score": number (0 or 1-10),
              "yoe": "exact years of professional experience the job is asking for.",
              "reason": "one blunt sentence explaining the score, concise, without fluff."
            }
            `.trim(),
    },




    ANYJOB: {
        name: "Any Job",
        jobQueries: [
            "office assistant", "data entry", "receptionist",
            "administrative assistant", "security guard", "customer success",
            "retail associate", "cashier", "warehouse associate",
        ],
        systemPrompt: `
            I'm a recent CS grad looking for any job that pays well, as fast, stable income while I pursue software engineering roles elsewhere. I have a CS degree and roughly 1 year of general work experience, and I'm available full-time.

            I'm not restricting this to white-collar/office work — I'll take any legal job, including tipped or commission-based roles, as long as the pay is good and it's realistic for me to actually get hired.

            Rank primarily by expected total pay, but weight down anything unrealistic for me to land — for example a role I'm clearly overqualified or underqualified for, one with a slow/competitive hiring process, or one requiring a license, certification, or specialized experience I don't have.

            When a posting doesn't list pay, estimate realistic total compensation using your best judgement — for example, a tipped role likely earns more in practice than its stated base wage suggests, while a role with no tips or commission should be judged on base pay alone. Say what you assumed in your reasoning.

            Give a 0 to:
            - Anything requiring a license or certification I don't have.
            - Anything requiring experience I don't have (e.g. "3+ years required").
            - Anything I'm objectively unqualified for regardless of pay.

            Otherwise score 1-10:
            - 8-10: high realistic total pay, no major barrier to getting hired quickly.
            - 5-7: decent pay but either a slower/harder hiring process, or pay is good but not exceptional.
            - 1-4: legal and technically appliable, but low pay or a rough combination of low pay and hard to get.
            - 0: unqualified per above.

            OUTPUT (valid JSON only, no markdown, no preamble):
            {
              "score": number (0 or 1-10),
              "yoe": "exact years of professional experience the job is asking for.",
              "reason": "one blunt sentence explaining the score and any pay assumption made, concise, without fluff."
            }
            `.trim(),
    },
}

// CONFIG

const buildProfile = (track, location, MAX_ROWS = 10, DAYS_OLD = "3") => {
    const { name, jobQueries, systemPrompt } = track

    return {
        name,
        jobQueries,
        systemPrompt,
        returnQueries() {
            return track.jobQueries.map(q => ({
                country: "us",
                query: q,
                location: location,
                maxRows: MAX_ROWS,
                sort: "date",
                fromDays: DAYS_OLD,
                enableUniqueJobs: true,
                includeSimilarJobs: true,
            }))
        },
    }
}

export const JOB_TYPE = JOB_OPTIONS.SWE
export const LOCATION = LOCATIONS.CA

export const JOB = buildProfile(JOB_TYPE, LOCATION)