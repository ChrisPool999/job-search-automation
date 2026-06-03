import { chromium } from 'playwright';

// example data shape the function expects
const resumeData = {
    name: 'Christopher Pool',
    contact: '(559) 274-2604 | christopherpool999@gmail.com | LinkedIn | GitHub | San Diego, CA',
    education: 'Bachelor of Science, Computer Science — Graduated Dec 2025, California State University East Bay',
    projects: [
        {
            name: 'Full-Stack Ecommerce Platform',
            stack: 'React | Next.js | Node.js | Express | TypeScript | PostgreSQL',
            bullets: [
                'Built and maintained RESTful API endpoints handling authentication and transactional operations',
                'Designed relational PostgreSQL schemas supporting user authentication and order processing',
                'Configured Docker and GitHub Actions CI/CD pipeline for automated testing and deployment'
            ]
        }
    ],
    skills: 'Python, C++, JavaScript, TypeScript | Node.js, Express, REST APIs | React, Next.js | PostgreSQL, SQL'
};

export async function generateResume() {
    console.log(1235)

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
            path: 'resume.pdf',
            format: 'Letter',
            printBackground: true,
            margin: {
                top: '0.5in',
                bottom: '0.5in',
                left: '0.5in',
                right: '0.5in'
            }
        });
        
        console.log('resume.pdf saved');
        
    } catch (err) {
        console.error(err);
    } finally {
        // always close the browser even if something throws
        // otherwise Chrome processes pile up in the background
        if (browser) await browser.close();
    }
}

function buildResumeHTML(data) {
    // returns a full HTML string that Puppeteer will render
    // template literals let you interpolate your resume data directly into the HTML
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    font-size: 11px;
                    margin: 0;
                    padding: 0;
                }
                h1 { font-size: 18px; margin-bottom: 4px; }
                h2 { font-size: 13px; border-bottom: 1px solid black; margin-bottom: 4px; }
                .contact { font-size: 10px; margin-bottom: 12px; }
                .project { margin-bottom: 10px; }
                .project-title { font-weight: bold; }
                .stack { color: #555; font-size: 10px; }
                ul { margin: 4px 0; padding-left: 16px; }
                li { margin-bottom: 2px; }
            </style>
        </head>
        <body>
            <h1>${data.name}</h1>
            <div class="contact">${data.contact}</div>
            
            <h2>Education</h2>
            <p>${data.education}</p>
            
            <h2>Projects</h2>
            <!-- maps over your projects array and generates a section for each one -->
            ${data.projects.map(project => `
                <div class="project">
                    <span class="project-title">${project.name}</span>
                    <span class="stack"> | ${project.stack}</span>
                    <ul>
                        <!-- maps over bullets array and generates a list item for each -->
                        ${project.bullets.map(b => `<li>${b}</li>`).join('')}
                    </ul>
                </div>
            `).join('')}
            
            <h2>Technical Skills</h2>
            <p>${data.skills}</p>
        </body>
        </html>
    `;
}