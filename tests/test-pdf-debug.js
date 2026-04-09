const resumeBuilder = require('./lib/resume-builder');
const fs = require('fs');

const mockText = `Ghasmir Ahmad
Lahore, Pakistan | +92 300 1234567 | ghasmir@email.com

Summary
Software engineer with experience in full-stack development and data analytics.

Experience
Associate Application Developer | Chakor | Lahore, Pakistan | 01/2023 - 09/2023
- Built a multi-tenant web application for an Australian company.
- Wrote API layers and integrated third-party services.
- Managed survey engine releases and bug fixes.
- Owned the pulse survey module after 3 months.

Education
Master of Science in Data Analytics | University of Engineering and Technology | 2022
Bachelor of Science in Computer Science | Punjab University | 2020`;

async function run() {
  console.log('--- TESTING USER SPECIFIC RESUME ---');
  
  const pdfBuffer = await resumeBuilder.generatePDF(mockText, {}, [], {}, { watermark: true, density: 'standard' });
  fs.writeFileSync('test-user-resume.pdf', pdfBuffer);
  
  const pdfStr = pdfBuffer.toString('latin1');
  const pages = (pdfStr.match(/\/Type\s*\/Page\b/g) || []).length;
  console.log('Final Pages:', pages);
  
  if (pages > 1) {
    console.error('FAIL: Resume exceeded 1 page!');
  } else {
    console.log('SUCCESS: Resume stayed on 1 page.');
  }
}

run();
