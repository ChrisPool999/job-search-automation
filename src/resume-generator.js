import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { exec } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUILD_DIR = path.resolve(__dirname, '../build');

function sanitizeFilename(value) {
    return value
        .replace(/[<>:\"/\\|?*\x00-\x1F]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase() || 'resume';
}

export async function generateResume(companyName = 'hello-world') {
    const dateSuffix = new Date().toISOString().slice(0, 10);
    const outputDir = path.join(BUILD_DIR, `${dateSuffix}-resumes`);
    fs.mkdirSync(outputDir, { recursive: true });

    const safeName = sanitizeFilename(companyName);
    const outputPath = path.join(outputDir, `${safeName}.pdf`);
    const html = buildResumeHTML(companyName);

    let browser;
    try {
        browser = await chromium.launch();
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle' });
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
        if (browser) await browser.close();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const companyArg = process.argv[2] || 'hello-world';
  await generateResume(companyArg).catch(() => process.exit(1));
}

function buildResumeHTML(companyName) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Christopher Pool - Resume</title>
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
</head>
<body>
<div class="page">

  <!-- HEADER -->
  <div class="header">
    <div class="header-name">Christopher Pool</div>
    <div class="header-contact">
      ${number} | christopherpool999@gmail.com |
      <a href="https://www.linkedin.com/in/christopher-pool-1677652a2/" target="_blank">LinkedIn</a> |
      <a href="https://github.com/ChrisPool999" target="_blank">GitHub</a> |
      ${location}
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

</div>
</body>
</html>
    `
}
