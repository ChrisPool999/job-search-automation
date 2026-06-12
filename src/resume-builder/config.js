export const buildPrompt = `
You are a resume editor tailoring bullet points to a job description.
Your goal is to mirror the language and keywords of the job description to make the resume ATS friendly, while keeping every bullet defensible in an interview.

The bar for a change is: if an interviewer asked you about it, could you answer confidently based on what was originally written? 
Extremely generic CS language can be used. Something you would assume any software engineer would know, examples such as documentation, tests, performance, clean code.

The general workflow should be to look at the job requirements.. you might see "Contribute to the architecture", okay architecture is broad enough to mention in our bullet points..
You continue reading.. "production-scale metal 3D printing system", okay production is a common term, and we can say we built a production level ecommerce site. However, metal 3D printing is pretty specific, and we don't have anything like that, so we probably can't add that keyword without it being a stretch.
You might go through the entire list, now the goal is to figure out which of the qualifying keywords are most important? Are some repeated? Is it important? Something like "develop software" is so generic that it doesn't help at all, despite fitting our requirements.

Notes after viewing some of your examples:
- avoid overusing the same word or phrase, especially adjectives. Once if enough unless it's warrented or natural,
- before adding, think about whether the change reflects my project. Adding "hardware interacing" is too specific, my C Compiler doesn't mention hardware anywhere, and it shouldn't be implied.
- Dont over force keywords that might be a stretch. "quality data logging across variable content", saying the LLM does data logging is a bit of stretch, its generates resume files.

Example:
Original: "Built automated data pipeline integrating multiple REST APIs"
JD uses: "data acquisition"
Output: "Built automated data acquisition pipeline integrating multiple REST APIs"

Do not change project titles.
Change the city in the header to match the job location only.
Output HTML only, exact same structure as input. No markdown, no preamble, no explanation.
`;

export const resumeCSS = `
<style>
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: "Times New Roman", Times, serif;
    font-size: 12pt;
    color: #000000;
    background: #ffffff;
  }

  .page {
    width: 8.5in;
    min-height: 11in;
    margin: 0 auto;
    padding: 0.5in;
    background: #ffffff;
  }

  /* ── HEADER ─────────────────────────────────────── */
  .header {
    text-align: center;
    margin-bottom: 4pt;
  }

  .header-name {
    font-size: 18pt;
    font-weight: bold;
    color: #000000;
    line-height: 1.2;
  }

  .header-contact {
    font-size: 12pt;
    color: #000000;
    line-height: 1.4;
    margin-top: 2pt;
  }

  .header-contact a {
    color: #1155cc;
    text-decoration: underline;
  }

  /* ── SECTION HEADINGS ────────────────────────────── */
  .section {
    margin-top: 14pt;
  }

  .section-title {
    font-size: 12pt;
    font-weight: bold;
    color: #1a3a5c;
    border-bottom: 1px solid #000000;
    padding-bottom: 1pt;
    margin-bottom: 7pt;
  }

  /* ── EDUCATION ───────────────────────────────────── */
  .edu-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .edu-degree {
    font-size: 12pt;
    font-weight: bold;
    color: #000000;
  }

  .edu-date {
    font-size: 12pt;
    font-weight: bold;
    color: #000000;
    white-space: nowrap;
  }

  .edu-school {
    font-size: 10pt;
    color: #000000;
    font-style: italic;
    margin-top: 1pt;
  }

  /* ── PROJECTS ────────────────────────────────────── */
  .project {
    margin-bottom: 10pt;
  }

  .project-header-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .project-title-line {
    font-size: 12pt;
    color: #000000;
  }

  .project-title-line strong {
    font-weight: bold;
  }

  .project-title-line a {
    color: #1155cc;
    text-decoration: underline;
  }

  .project-date {
    font-size: 12pt;
    color: #000000;
    white-space: nowrap;
    margin-left: 12pt;
  }

  .project-tech {
    font-size: 12pt;
    color: #000000;
    margin-top: 1pt;
    margin-bottom: 3pt;
  }

  /* ── BULLETS ─────────────────────────────────────── */
  .project-bullets {
    margin: 0;
    padding: 0;
  }

  .bullet-item {
    font-size: 12pt;
    color: #000000;
    padding-left: 18pt;
    position: relative;
    margin-bottom: 3pt;
    line-height: 1.45;
  }

  .bullet-item::before {
      content: "●";
      position: absolute;
      left: 4pt;
      font-size: 7pt;
      top: 4pt;
  }

  /* ── SKILLS ──────────────────────────────────────── */
  .skills-section {
    margin-top: 8pt;
  }

  .skill-row {
    font-size: 12pt;
    color: #000000;
    margin-bottom: 3pt;
    line-height: 1.45;
  }

  .skill-label {
    font-weight: bold;
    color: #1a3a5c;
  }

  @media print {
    body { background: #ffffff; }
    .page {
      margin: 0;
      padding: 0.5in;
      width: 8.5in;
      min-height: 11in;
    }
  }
</style>
`

export const resumeBody = `
  <div class="header">
    <div class="header-name">Christopher Pool</div>
    <div class="header-contact">
      (559) 223 - 3280  | christopherpool999@gmail.com |
      <a href="https://www.linkedin.com/in/christopher-pool-1677652a2/" target="_blank">LinkedIn</a> |
      <a href="https://github.com/ChrisPool999" target="_blank">GitHub</a> |
      Fresno, CA
    </div>
  </div>

  <!-- EDUCATION -->
  <div class="section">
    <div class="section-title">Education</div>
    <div class="edu-row">
      <span class="edu-degree">Bachelor of Science, Computer Science</span>
      <span class="edu-date">Graduated: Dec 2025</span>
    </div>
    <div class="edu-school"><em>California State University East Bay</em> - Hayward, CA</div>
  </div>

  <!-- PROJECTS -->
  <div class="section">
    <div class="section-title">Projects</div>

    <!-- Project 1 -->
    <div class="project">
      <div class="project-header-row">
        <div class="project-title-line">
          <strong>Full-Stack Ecommerce Site</strong> -
          <a href="https://github.com/ChrisPool999/ecommerce" target="_blank">GitHub</a> |
          <a href="https://ecommerce-web-sze7.vercel.app/" target="_blank">Live Demo</a>
        </div>
        <div class="project-date">Jan 2026 - Feb 2026</div>
      </div>
      <div class="project-tech">React | Next.js | Node.js | Express | TypeScript | PostgreSQL | Docker | GitHub Actions</div>
      <div class="project-bullets">
        <div class="bullet-item">Built React/TypeScript frontend with server-side rendering via Next.js supporting product catalog, cart, and checkout flows</div>
        <div class="bullet-item">Designed REST API in Node.js/Express handling authentication, order processing, and product management backed by PostgreSQL</div>
        <div class="bullet-item">Containerized full application stack with Docker and automated test and deployment pipeline via GitHub Actions CI/CD</div>
      </div>
    </div>

    <!-- Project 2 -->
    <div class="project">
      <div class="project-header-row">
        <div class="project-title-line">
          <strong>LLM Job Application Pipeline</strong> -
          <a href="https://github.com/ChrisPool999/job-search-automation" target="_blank">GitHub</a>
        </div>
        <div class="project-date">Feb 2026</div>
      </div>
      <div class="project-tech">Node.js | Python | Claude API | Gemini API | Apify</div>
      <div class="project-bullets">
        <div class="bullet-item">Built end-to-end job sourcing pipeline scraping 100+ listings daily via Apify, deduplicating results and persisting structured output to a shared JSON store</div>
        <div class="bullet-item">Integrated Gemini API to score and filter job listings against a candidate profile, reducing manual review to only high-signal matches above a configurable threshold</div>
        <div class="bullet-item">Engineered LLM-driven resume tailoring system generating job-specific HTML resumes by mirroring job description language while preserving factual accuracy</div>
        <div class="bullet-item">Automated PDF generation from tailored HTML using Playwright with consistent formatting across variable resume content</div>
      </div>
    </div>

    <!-- Project 3 -->
    <div class="project">
      <div class="project-header-row">
        <div class="project-title-line">
          <strong>C Compiler Frontend</strong> -
          <a href="https://github.com/ChrisPool999/C-Compiler" target="_blank">GitHub</a>
        </div>
        <div class="project-date">Dec 2024 - April 2025</div>
      </div>
      <div class="project-tech">Python | C++ | Linux | Test Automation | Git</div>
      <div class="project-bullets">
        <div class="bullet-item">Built LALR(1) parse table generator from scratch in Python, constructing canonical LR(0) item sets, computing closure and goto transitions across 200+ states, and merging lookahead sets to resolve shift/reduce conflicts</div>
        <div class="bullet-item">Implemented lexer in C++ tokenizing raw source input against BNF grammar rules with error recovery for malformed input</div>
        <div class="bullet-item">Developed test suite of 30+ cases covering edge cases, error recovery, and parser correctness validated against known C grammar inputs</div>
      </div>
    </div>

  </div>

  <!-- SKILLS -->
  <div class="skills-section">
    <div class="skill-row"><span class="skill-label">Programming Languages:</span> JavaScript, TypeScript, Python, C++, C#</div>
    <div class="skill-row"><span class="skill-label">Frameworks &amp; Libraries:</span> React, Next.js, Node.js, Express</div>
    <div class="skill-row"><span class="skill-label">Databases:</span> PostgreSQL, SQL, Prisma ORM</div>
    <div class="skill-row"><span class="skill-label">Tools &amp; Infrastructure:</span> Git, Docker, GitHub Actions, CI/CD, Linux</div>
  </div>
`