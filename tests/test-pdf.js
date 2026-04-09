const { buildResumeData } = require('./lib/resume-builder');
const fs = require('fs');

const mockText = `John Doe
johndoe@email.com | 123-456-7890 | linkedin.com/in/johndoe

SUMMARY
Experienced software engineer with 5 years of experience in full-stack development.

EXPERIENCE
Software Engineer
Tech Company | New York, NY | 01/2020 - Present
* Developed high-performance web applications using React and Node.js.
* **Improved performance** by **40%** by optimizing database queries.
* Collaborated with cross-functional teams to deliver features on time.
`;

async function run() {
  const resumeBuilder = require('./lib/resume-builder');
  try {
    const pdfBuffer = await resumeBuilder.generatePDF(mockText, {}, [], {});
    fs.writeFileSync('test.pdf', pdfBuffer);
    console.log("PDF generated. Size:", pdfBuffer.length);
  } catch (err) {
    console.error("PDF generator failed:", err);
  }
}
run();
