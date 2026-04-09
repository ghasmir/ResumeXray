const { PDFDocument } = require('pdfkit');
const fs = require('fs');

const doc = new PDFDocument();
doc.pipe(fs.createWriteStream('test-bug.pdf'));

const parts = ["Hello ", "world, ", "this ", "is ", "a ", "test ", "of ", "lineGap."];
parts.forEach((text, i) => {
  doc.text(text, { continued: i < parts.length - 1, lineGap: 50 });
});
doc.text('Next line', {lineGap: 50});
doc.end();
