const { generatePDF, generateDOCX } = require('./lib/resume-builder');
const fs = require('fs');

const sampleResume = `
JANE SMITH
jane.smith@example.com | 555-0199 | san francisco, ca
linkedin.com/in/janesmith | github.com/janesmith

SUMMARY
Software Engineer with 2 years of experience building scalable web applications. Expert in React, Node.js, and Cloud Infrastructure.

EXPERIENCE
ACME CORP
Software Engineer | 2023 - Present
• Reduced API latency by 45% by implementing specialized Redis caching layer for 2M+ users.
• Led migrations from monolithic architecture to microservices, improving deployment velocity by 30%.
• Automated CI/CD pipelines using GitHub Actions, saving 10+ hours of manual work per week.

TECH STARTUP
Junior Developer | 2022 - 2023
• Built responsive dashboard using React and Tailwind CSS, increasing user engagement by 15%.
• Optimized SQL queries in PostgreSQL, reducing database load by 20% during peak hours.

PROJECTS
ALGO VISUALIZER
• Developed an interactive algorithm visualizer using Go and WebAssembly, used by 500+ students.
• Achieved 98/100 Lighthouse performance score through code splitting and asset optimization.

SKILLS
Languages: JavaScript, TypeScript, Go, SQL, HTML, CSS
Frameworks: React, Node.js, Express, Next.js, Tailwind
Tools: Docker, Kubernetes, AWS, Git, Redis, PostgreSQL

EDUCATION
UNIVERSITY OF CALIFORNIA, BERKELEY
B.S. Computer Science | 2018 - 2022
`;

async function test() {
  console.log('🚀 Generating Junior (One-Page) PDF...');
  const pdfBuffer = await generatePDF(sampleResume, { contactInfo: { hasEmail: true } }, [], []);
  fs.writeFileSync('junior_faang_resume.pdf', pdfBuffer);
  console.log('✅ PDF saved: junior_faang_resume.pdf');

  console.log('🚀 Generating Junior (One-Page) DOCX...');
  const docxBuffer = await generateDOCX(sampleResume, { contactInfo: { hasEmail: true } }, [], []);
  fs.writeFileSync('junior_faang_resume.docx', docxBuffer);
  console.log('✅ DOCX saved: junior_faang_resume.docx');
}

test().catch(console.error);
