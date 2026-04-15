#!/usr/bin/env node
/**
 * Test PDF generation with REAL data from the latest scan in the database.
 * This exactly replicates what the preview route does.
 */

const path = require('path');
const db = require('../db/database');
const { closeBrowser } = require('../lib/playwright-browser');
const { renderResumePdf, resolveResumeText } = require('../lib/render-service');
const fs = require('fs');

async function run() {
  // Get the latest scan
  const latestScan = db.getDb().prepare('SELECT * FROM scans ORDER BY id DESC LIMIT 1').get();
  if (!latestScan) { console.error('No scans in database'); return; }

  console.log(`\nScan ID: ${latestScan.id}`);
  console.log(`User ID: ${latestScan.user_id}`);
  
  // Parse the JSON columns exactly like the preview route does
  const { resumeText, source } = resolveResumeText(latestScan);
  const sectionData = latestScan.section_data ? JSON.parse(latestScan.section_data) : {};
  const optimizedBullets = latestScan.optimized_bullets ? JSON.parse(latestScan.optimized_bullets) : [];
  const keywordPlan = latestScan.keyword_plan ? JSON.parse(latestScan.keyword_plan) : [];

  console.log(`\nResume text length: ${resumeText.length}`);
  console.log(`Resume text (first 500 chars):\n---\n${resumeText.substring(0, 500)}\n---\n`);
  console.log(`Section data keys: ${JSON.stringify(Object.keys(sectionData))}`);
  console.log(`Optimized bullets count: ${optimizedBullets.length}`);
  console.log(`Keyword plan count: ${keywordPlan.length}`);

  if (!resumeText || resumeText.length < 50) {
    console.error('\n⚠ PROBLEM: no renderable resume text is available.');
    console.log(`Resolved source: ${source}`);
    console.log('Section data:', JSON.stringify(sectionData, null, 2).substring(0, 1000));
    return;
  }

  // Now call the same validated render pipeline the preview/download routes use
  try {
    const { buffer, renderMeta } = await renderResumePdf(latestScan, { watermark: true });

    const outputPath = path.join(process.cwd(), 'test-live-output.pdf');
    fs.writeFileSync(outputPath, buffer);
    console.log(`\nPDF generated: ${buffer.length} bytes`);
    console.log(`Render template: ${renderMeta.renderTemplate}`);
    console.log(`Render density: ${renderMeta.renderDensity}`);
    console.log(`Resume text source: ${renderMeta.resumeTextSource}`);

    // Count pages
    const pdfStr = buffer.toString('latin1');
    const pages = (pdfStr.match(/\/Type\s*\/Page\b/g) || []).length;
    console.log(`Page count: ${pages}`);
    console.log(`Saved to: ${outputPath}`);

    if (pages > 2) {
      console.error(`\n❌ FAIL: ${pages} pages — way too many for a resume!`);
    } else {
      console.log(`\n✅ PASS: ${pages} page(s)`);
    }
  } catch (e) {
    console.error('generatePDF error:', e);
  }

  await closeBrowser();
  await db.closeDb();
}

run();
