const { compileTypst } = require('./lib/typst-compiler');
const fs = require('fs');
const path = require('path');

async function test() {
  console.log('--- Testing Typst Bridge ---');
  
  // Create a minimal dummy template if not exists
  const templatePath = path.join(__dirname, 'resume.typ');
  if (!fs.existsSync(templatePath)) {
    console.log('No resume.typ found. Creating a minimal one for testing...');
    fs.writeFileSync(templatePath, '#[Hello #author_name!]');
  }

  const variables = {
    name: 'John Doe',
    contact: ['john@example.com', '123-456-7890'],
    summary: 'Experienced Software Engineer with a focus on high-fidelity rendering engines.',
    sections: {
      "Experience": ["Built a WASM-based PDF engine for resume parsing."],
      "Education": ["B.S. Computer Science"]
    },
    isJunior: true
  };

  try {
    const pdfBuffer = await compileTypst(templatePath, variables);
    console.log(`✅ Compilation Success! PDF Size: ${pdfBuffer.length} bytes`);
    
    // Save for manual inspection
    fs.writeFileSync('test_output.pdf', pdfBuffer);
    console.log('✅ saved to test_output.pdf');
  } catch (err) {
    console.error('❌ Compilation Failed:', err.message);
  }
}

test();
