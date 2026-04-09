#!/usr/bin/env node
const db = require('./db/database');
const { buildResumeData } = require('./lib/resume-builder');

const latestScan = db.getDb().prepare('SELECT * FROM scans ORDER BY id DESC LIMIT 1').get();

const resumeText = latestScan.optimized_resume_text || '';
const sectionData = latestScan.section_data ? JSON.parse(latestScan.section_data) : {};
const optimizedBullets = latestScan.optimized_bullets ? JSON.parse(latestScan.optimized_bullets) : [];
const keywordPlan = latestScan.keyword_plan ? JSON.parse(latestScan.keyword_plan) : [];

// Test buildResumeData
const data = buildResumeData(resumeText, sectionData, optimizedBullets, keywordPlan);
const { sections, isJunior, yearsExp } = data;

console.log('Name:', JSON.stringify(sections.name));
console.log('Contact:', JSON.stringify(sections.contact));
console.log('Summary lines:', sections.summary ? sections.summary.split('\n').filter(l => l.trim()).length : 0);
console.log('Experience lines:', sections.experience?.length);
console.log('Education lines:', sections.education?.length);
console.log('Skills lines:', sections.skills?.length);
console.log('Projects lines:', sections.projects?.length);
console.log('Certs lines:', sections.certifications?.length);
console.log('Languages lines:', sections.languages?.length);
console.log('Other:', JSON.stringify(sections.other?.substring(0, 200)));
console.log('\nYears Exp:', yearsExp);
console.log('Is Junior:', isJunior);

// Print each experience line
console.log('\n--- EXPERIENCE LINES ---');
(sections.experience || []).forEach((l, i) => console.log(`  [${i}] ${l.substring(0, 120)}`));

console.log('\n--- SKILLS LINES ---');
(sections.skills || []).forEach((l, i) => console.log(`  [${i}] ${l.substring(0, 120)}`));

// Total line count for density calc
const allLines = [
  ...(sections.summary ? sections.summary.split('\n').filter(l => l.trim()) : []),
  ...(sections.experience || []),
  ...(sections.education || []),
  ...(sections.skills || []),
  ...(sections.projects || []),
  ...(sections.certifications || []),
  ...(sections.languages || []),
];
console.log('\nTotal lines for density calc:', allLines.length);

db.closeDb();
