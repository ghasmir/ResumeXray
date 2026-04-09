const { analyzeResume } = require('./lib/analyzer');

(async () => {
  try {
    const text = 'John Doe\njohn.doe@example.com\n\nEXPERIENCE\nDeveloper\n- Built things\n\nEDUCATION\nBS Computer Science';
    const jd = 'We are looking for a Software Engineer with JavaScript experience to work in Galway.';
    const result = await analyzeResume(text, jd);
    console.log("Success:", !!result.semanticData);
  } catch (e) {
    console.error('Test Failed:', e);
  }
})();
