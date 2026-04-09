/**
 * Score calculator & recommendation generator based on X-Ray, Format Doctor, and Keywords.
 */

/**
 * Generate actionable recommendations.
 */
function generateRecommendations(keywordResults, xrayData, formatIssues) {
  const recs = [];

  // ── Format & Parse Recommendations ─────────────────────────────────────────
  if (xrayData.parseRate < 80) {
    recs.push({
      category: 'Parsing',
      priority: 'high',
      icon: '🔴',
      title: 'Major Parsing Failures',
      description: `The parser could only read ${xrayData.parseRate}% of your resume. Critical fields like your experience or contact info are unreadable. Use a simpler format to fix this.`,
      items: [],
    });
  }

  for (const issue of formatIssues) {
    recs.push({
      category: 'Formatting',
      priority: issue.severity,
      icon: issue.severity === 'high' ? '⚠️' : '💡',
      title: issue.title,
      description: issue.message,
      items: [issue.fix],
    });
  }

  // ── Keyword recommendations ───────────────────────────────────────────
  if (keywordResults && keywordResults.missing && keywordResults.missing.length > 0) {
    const topMissing = keywordResults.missing.slice(0, 8).map((k) => k.term);
    recs.push({
      category: 'Keywords',
      priority: 'high',
      icon: '🔑',
      title: 'Add Missing Keywords',
      description: `Your resume is missing ${keywordResults.missing.length} keywords from the job description. Consider naturally incorporating these terms:`,
      items: topMissing,
    });

    const missingHard = keywordResults.missing.filter((k) => k.category === 'hard_skill');
    if (missingHard.length > 0) {
      recs.push({
        category: 'Skills',
        priority: 'high',
        icon: '💻',
        title: 'Address Technical Skills Gap',
        description: `The job requires technical skills not found in your resume:`,
        items: missingHard.map((k) => k.term),
      });
    }

    const missingSoft = keywordResults.missing.filter((k) => k.category === 'soft_skill');
    if (missingSoft.length > 2) {
      recs.push({
        category: 'Skills',
        priority: 'medium',
        icon: '🤝',
        title: 'Highlight Soft Skills',
        description: `Weave these soft skills into your experience bullets:`,
        items: missingSoft.map((k) => k.term),
      });
    }
  }

  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  recs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return recs;
}

module.exports = { generateRecommendations };
