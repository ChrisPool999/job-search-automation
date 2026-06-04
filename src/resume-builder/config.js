export const buildPrompt = `
You are tailoring a resume for a specific job posting. Rewrite the resume bullets to match the job description language and requirements, staying truthful to what the candidate actually built.

RULES:
- Output HTML only, mirroring the exact structure of the resume HTML given
- Only change bullet text content, tech stack lines, and the city in the header
- Do not add or remove entire projects
- Do not invent skills or experience the candidate does not have
- Match the job description terminology where honest
- Keep bullets concise, one to two lines max
- No filler phrases like "demonstrated ability to" or "showcasing proficiency in"
- No em dashes
- Swap the city in the header to match the job location

OUTPUT: HTML only, no markdown, no preamble, no explanation.
`

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
    font-size: 13pt;
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

  .project-bullets {
    list-style: none;
    padding-left: 0;
    margin: 0;
  }

  .project-bullets li {
    font-size: 12pt;
    color: #000000;
    padding-left: 18pt;
    position: relative;
    margin-bottom: 3pt;
    line-height: 1.45;
  }

  .project-bullets li::before {
    content: "●";
    position: absolute;
    left: 4pt;
    font-size: 7pt;
    top: 2pt;
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
      <ul class="project-bullets">
        <li>Built responsive, user-friendly UI components using React, HTML5, CSS3, and TypeScript with optimization for usability and performance across devices</li>
        <li>Designed and maintained server-side REST APIs and backend services using Node.js/Express for authentication, data transformations, and transactional operations</li>
        <li>Worked with PostgreSQL database for data storage, schema design, and query optimization supporting user authentication, product catalogs, and order processing</li>
        <li>Wrote clean, maintainable, and well-documented code with Git version control; participated in testing, debugging, and deployment using Docker and GitHub Actions CI/CD</li>
      </ul>
    </div>

    <!-- Project 2 -->
    <div class="project">
      <div class="project-header-row">
        <div class="project-title-line">
          <strong>LLM-Powered Job Triage Agent</strong> -
          <a href="https://github.com/ChrisPool999/job-search-automation" target="_blank">GitHub</a>
        </div>
        <div class="project-date">Feb 2026</div>
      </div>
      <div class="project-tech">Node.js | Python | Claude API | Gemini API | Apify</div>
      <ul class="project-bullets">
        <li>Designed and deployed software solution automating workflows by integrating multiple REST APIs with structured JSON output for data processing</li>
        <li>Built data pipeline with deduplication logic and documented design procedures; performed thorough testing to identify and resolve bugs</li>
        <li>Demonstrated ability to learn new technologies quickly and solve technical challenges in a self-directed environment</li>
      </ul>
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
      <ul class="project-bullets">
        <li>Built lexer and LALR(1) parser generator in Python and C++ using BNF grammars with automated parse table generation</li>
        <li>Developed comprehensive test suite of 30+ cases covering edge cases and error handling; utilized Git for version control throughout development</li>
      </ul>
    </div>

  </div>

  <!-- SKILLS -->
  <div class="skills-section">
    <div class="skill-row"><span class="skill-label">Programming Languages:</span> JavaScript, TypeScript, Python, C++, C#</div>
    <div class="skill-row"><span class="skill-label">Frameworks &amp; Libraries:</span> React, Next.js, Node.js, Express, .NET</div>
    <div class="skill-row"><span class="skill-label">Databases:</span> PostgreSQL, SQL, Prisma ORM</div>
    <div class="skill-row"><span class="skill-label">Tools &amp; Infrastructure:</span> Git, Docker, GitHub Actions, CI/CD, Linux</div>
  </div>
`