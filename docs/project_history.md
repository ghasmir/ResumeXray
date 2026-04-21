# ResumeXray Platform: Complete Project History & Chronological Ledger

This exhaustive document tracks both the macro-architectural evolution of the ResumeXray platform and the precise step-by-step, day-by-day chronological implementations based on Git and SRE histories.

Reconciliation note:
- This ledger has been manually reconciled against the current repository state and recent git history through the active April 2026 workstream.
- Going forward, it should be updated alongside meaningful changes to architecture, runtime behavior, deployment, or product flow.

---

# Part 1: Macro-Architectural Evolutions (Thematic History)
*Derived from historical AI Agent implementations plans, detailing the conceptual evolution from a basic utility to a FAANG-grade platform.*

## 1. Foundation: The ATS Resume Checker Prototype
The initial application was conceived to bridge the gap between candidate resumes and raw job descriptions.
- **Core Analysis Engine**: Engineered a pipeline to score resumes based on strict Job Description keywords, extracting an "ATS Compatibility Score".
- **Gap Analysis**: Developed mechanisms to pinpoint formatting errors and missing high-value capabilities.

## 2. The "FAANG-Level" Resume Engine Overhaul
It was decided that merely checking resumes wasn’t enough—we needed to programmatically *generate* high-caliber documents.
- **Experience-Based Formatting Algorithms**: Implemented dynamic logic calculating tenure. Candidates under 3 years of experience are dynamically compressed into high-density **One-Page**, single-column layouts optimized for modern ATS parsers like Workday and Lever.
- **Premium Typography & Styling**: Added support for `.docx` generation (using Aptos/Calibri) and PDF embedding (utilizing clean Sans-Serif fonts like Helvetica/Inter).
- **Metric Highlighting**: Built a system to parse qualitative bullets and intelligently auto-bold critical numerical metrics (e.g., "$1M", "25%") to ensure they pop for human reviewers.

## 3. Major Platform Upgrade: Identity, Access & Profiles
The application transitioned from a stateless utility into a secure SaaS platform.
- **Authentication & Gating**: Delivered a robust auth framework requiring verified email identities before granting full access to premium tiers (Cover Letters, Recruiter Views). Fixed deep CSRF & session validation regressions.
- **Profile Image Subsystem**: Integrated image uploading via `sharp`, leveraging OWASP Magic Number validation and EXIF metadata stripping to protect user privacy.
- **Copy Protection & Security**: Built specialized frontend copy-protection into Cover Letter UI components to prevent unverified data scraping.
- **Visual Homogenization**: Introduced "Glassmorphism" styling inside the ATS diagnosis gauges for a premium, unified aesthetic.

## 4. Frontend Rewrites & Structural Restoration
During scale-up, CSS cascade failures and module errors were systematically eliminated.
- **Build Pipeline Overhaul**: We completely excised the Vite/ESM build pipeline that was causing CI deployment breakages, rewriting the app architecture into robust vanilla JavaScript chunks (`app.js`).
- **Comprehensive CSS/JS Cleanup**: Executed a "Full Audit & Restoration" covering broken parsers, missing basic variable declarations, orphaned script logic, and enforcing FAANG-level in-code documentation.
- **Mobile UI Rescue**: Fixed critical Viewport bugs natively, such as the 2x2 grid collapses on the main tabs, Score Gauge padding, and the iPhone 15 Pro PDF rendering cutoff. Added dynamic fallback UI loops when a PDF fails visual text extraction.

---

# Part 2: Step-by-Step Chronological Ledger (Git Timeline)
*A strict, day-by-day mapping of what was added (Implemented) and what was patched or deleted (Removed/Fixed), spanning since the v2.8.0 release.*

## Timeline: 2026-04-09
**Focus:** Version 2.8.0 Release & Core Identity/Infrastructure Patches

**Implemented (Added):**
- **Production Overhauls**: Shifted all internal routing URLs natively to the Railway production domains.
- **Identity & Auth**: Built real-time Password Strength UI into the profile modal and restricted password reuse. 
- **Infrastructure Buffers**: Heavily increased Redis timeout limits to account for Upstash Serverless cold-starts.

**Removed / Fixed:**
- **Critical Auth Loops**: Squashed a severe mobile bug forcing infinite logout/re-login loops, and patched a race-condition during the standard logout flow. 

## Timeline: 2026-04-10
**Focus:** Major Platform IAM Upgrades & Security Gating

**Implemented (Added):**
- **IAM Identity Access & SSO**: Embedded the OAuth/Email verification gate. Configured proper SSO forgot-password loops and built logic for seamless account linking into PostgreSQL (via `atsProfileCache` Maps).
- **Security Mitigation**: Fixed 12 outstanding audit issues, primarily halting CSRF race conditions upon sign-ups.

**Removed / Fixed:**
- **UI Bloat**: Removed focus outline boxes strictly from SPA nav headings for a cleaner aesthetic.
- **Vague Errors**: Ripped out generic "Analysis failed" dummy copy and replaced it with real, trace-linked error parsing. Removed widespread duplicate CSS and cleaned up the `auth.js` backend logic.
- **Crash Factors**: Fixed missing dummy dependencies (e.g. `atsProfileCache`) that caused immediate `ReferenceError` crashes during PDF scanning.

## Timeline: 2026-04-11
**Focus:** Kimi AI Swapping & Mobile Layout Polishing

**Implemented (Added):**
- **Kimi AI Foundation**: Explicitly added the free **Kimi K2 AI** model layer directly into `lib/llm-service.js` utilizing Puter.js as a cost-free LLM routing alternative.
- **Mobile Grid**: Completely restructured the Tab navigation into a 2x2 CSS Grid specifically to resolve viewport squeezing on mobile devices.
- **OAuth Linker**: Configured automatic merging logic linking new OAuth logins to pre-existing email/password accounts. 

**Removed / Fixed:**
- **Mobile Clipping**: Patched the native rendering limits causing the PDF iframe to clip aggressively off-screen on iPhone layouts.

## Timeline: 2026-04-12
**Focus:** FAANG-Level Redesign, PII & PDF Upgrades

**Implemented (Added):**
- **FAANG-Level Scan Page**: Overhauled the raw scan interface entirely. Began live-detecting company names correctly instead of enforcing dummy labels.
- **PDF Rendering Restructure**: Programmed adaptive iframe heights for the PDF preview mode. Added notification toasts when a user's PDF cannot be optically processed by the AI layer (suggesting `.docx` mapping).
- **Data Protection**: Established strict PII masking inside the generated "Recruiter View" tables for any unauthorized guest scans. 

**Removed / Fixed:**
- **Redundant Context Header**: Purged the entire "scan context header bar" spanning over 100 lines of CSS.
- **Exploits**: Closed a critical logic loophole that previously permitted unauthenticated, 0-credit document downloads. Stopped universally falling back to "LinkedIn" for missing company derivations.

## Timeline: 2026-04-13
**Focus:** Comprehensive Hardening (Phases 1-6 Audits & Production DB)

**Implemented (Added):**
- **Production Databases & Migrations**: Drafted `db/pg-schema.sql` and `db/pg-database.js` to transfer local SQLite logic into robust Supabase PostgreSQL. Integrated rigorous foreign keys and query limiters.
- **Security Phase Patching (C-1 to A-8)**: Enforced strict `x-forwarded-for` ip proxy tracking, bounded HTTP rate limits, and rebuilt the entire CSRF lifecycle manually through `middleware/csrf.js`. 
- **Accessibility (WCAG)**: Deployed Phase 3 Accessibility fixes tightening color contrast layers and enforcing SSE (Server Sent Events) reconnection layers natively.
- **High-Availability PM2 Architecture**: Orchestrated `ecosystem.config.js`. Scaled node operation across 2 clustered workers mapping back to Hostinger VKS vCPUs. Limited memory to 750MB/worker (mirroring `--max-old-space-size=700`), instituted exponential restart backoffs (`exp_backoff_restart_delay: 100`), and forced a generous 30-second `kill_timeout` to ensure LLM/SSE sessions drain elegantly before restarts drop.

**Removed / Fixed:**
- **Vite & ESM Pipeline Extirpation**: Made the decision to entirely abandon the Vite build structure. Removed thousands of lines mapped to `.mjs` modules and `tsconfig.json`, returning the SPA explicitly to simple vanilla JavaScript elements to resolve CI failure loops forever.
- **Dummy Assets**: Cleared outdated `GA_Resume.pdf` and `junior_faang_resume.docx` bin elements taking up static space.

## Timeline: 2026-04-14
**Focus:** Material Design Implementations

**Implemented (Added):**
- **UI Progressions System**: Established a Material Design-inspired visual system introducing actionable empty states containing clear CTA funnels.
- **Progressive Disclosure**: Built UX states that slowly reveal the scan pipeline's data rather than dumping it concurrently.
- **Google-Level Adjustments**: Sized up touch targets universally across the device width to pass Apple/Google UX standard constraints.

**Removed / Fixed:**
- **Grid De-sync**: Re-aligned the broken CSS flow breaking the horizontal axis on the Recruiter Tables.

## Timeline: 2026-04-15
**Focus:** Frontend Audit Remediation & SPA Consolidation

**Implemented (Added):**
- **Frontend Audit Sweep**: Implemented route-aware document titles, keyboard-safe scan-history cards, clearer scan progressive disclosure, pricing copy cleanup, support-text readability upgrades, compact utility footers, and stronger signed-in workspace hierarchy.
- **Results UX Upgrade**: Added a clearer results masthead, top-priority summary strip, stronger dashboard/profile guidance cards, and richer scan-state messaging throughout the live SPA.
- **SPA Source-of-Truth Decision**: Formalized `public/index.html` + `public/js/app.js` + `public/css/styles.css` as the single active frontend, documented the architecture, and repurposed build verification around the live SPA instead of a parallel Vite client.

**Removed / Fixed:**
- **Legacy Frontend Drift**: Removed the inactive modular `src/` frontend path, dropped `vite.config.js` and stale TS build artifacts, and eliminated the repo ambiguity around which client was actually live.
- **Visual Inconsistencies**: Cleaned up mismatched tone in pricing, auth, scan, and results surfaces, including casual labels and other UI moments that undercut the premium presentation.

## Timeline: 2026-04-16
**Focus:** Core Flow Rescue, Export Reliability, and Landing Cohesion

**Implemented (Added):**
- **Server-Owned Job Context**: Centralized job-link intake around a normalized `jobContext` flowing through backend processing, scan persistence, results, preview, history, and cover-letter generation.
- **ATS-Aware Preview/Export Pipeline**: Unified preview and export generation behind the same validated render path, stored render metadata on scans, and added stricter fallback behavior for resume PDF generation.
- **Guest Flow & Results Rescue**: Reworked guest scan behavior so resume-only passes are clearly labeled, preview-before-pay is explicit, recruiter view is more readable, and invalid preview states render as designed UI rather than raw backend output.
- **History & Flow Regression Coverage**: Added and repaired seed/test coverage for core scan flows, ATS URL handling, and PDF preview validation.
- **Project Ledger Maintenance**: Resumed updating this history file to reflect current engineering work rather than leaving it frozen at the earlier architectural cleanup stage.

**Removed / Fixed:**
- **False Partial Completion State**: Fixed the SSE completion logic that was incorrectly showing `Analysis completed with partial results.` after successful scans.
- **Broken Export Preview Handoff**: Rebuilt PDF preview loading to fetch the generated PDF first, render it through a blob-backed iframe, and correctly reveal the preview in both live and saved-history results.
- **PDF Rendering Regressions**: Fixed malformed date normalization, improved contact/headline recovery, tightened experience parsing, simplified entry header layout for better ATS-safe reading order, and corrected CSP to allow the new blob preview flow.
- **Redis Degradation Path**: Hardened Redis fallback so transient Upstash timeouts stop stalling normal page requests and degrade to local behavior faster.
- **Landing Feature Strip Mismatch**: Restyled the landing-page feature/proof strip so it now matches the premium glass-card language used elsewhere on the marketing site instead of appearing like a disconnected mono-dashboard widget.
- **Results Workspace Chrome Bloat**: Folded the job-context strip into the results masthead, simplified the workspace status language, removed repeated context noise, and redesigned the recruiter visibility tab from a raw debug-style table into a structured review grid with a clearer keyword signal panel.

## Timeline: 2026-04-17
**Focus:** CSP Verification Closure, Local Runtime Recovery, Frontend Modularization, and Documentation Hygiene

**Implemented (Added):**
- **Phase 1 CSP Closure**: Removed the remaining inline `onclick` handlers from the live SPA runtime and routed those interactions through centralized `data-*` event delegation inside `public/js/app.js`, keeping the frontend aligned with the strict CSP policy already enforced in `config/security.js`.
- **Native Module Recovery Path**: Re-verified the local SQLite runtime under a newer Node ABI by rebuilding `better-sqlite3`, restoring local server boot and the main smoke/core verification path without needing to wipe `node_modules` or regenerate the lockfile.
- **Verified Local Boot Path**: Confirmed a clean local startup flow using the documented Redis-free fallback path (`UPSTASH_REDIS_URL=`), with healthy `/healthz` and `/readyz` responses while SQLite remained the active local datastore.
- **Phase 2 Frontend Extraction**: Started the native-ES-module "strangler fig" split by pulling shared UI helpers into `public/js/modules/ui-helpers.mjs` and PDF preview behavior into `public/js/modules/pdf-preview.mjs`, while preserving `public/js/app.js` as the stable orchestration layer.
- **Frontend Verification Path**: Re-verified the extracted frontend path with `npm run syntax:frontend`, `npm test`, a clean local boot, and a browser smoke confirming the SPA initialized successfully after loading the new dynamic imports.
- **Docs Maintenance**: Updated `README.md` and `TECHNICAL_DOCUMENTATION.md` with the verified `better-sqlite3` rebuild recovery step, the recommended local boot command when Upstash is intentionally disabled, and the new frontend module ownership boundaries.
- **Document Pipeline Stabilization**: Rebuilt the fundamental document generation flow. Transitioned from a fragile flat-text pre-parse string replacement process into a safer `parse → structure → surgically rewrite objects` model, and upgraded `generateDOCX()` to consume structural nodes directly.
- **Results UX Refinement**: Preserved the intended results-tab order as ATS Diagnosis → Recruiter View → Export Preview → Cover Letter and allowed sandboxed scripts/popups in the PDF preview iframe so users can fully expand generated drafts.

**Removed / Fixed:**
- **Blocked Smoke Suite**: Eliminated the `better-sqlite3` ABI mismatch that had been preventing the smoke suite from spawning a local server, returning `npm test` to a fully green state (`21/21` passing).
- **Inline Handler Drift**: Closed the last known gap between runtime behavior and the configured CSP by replacing inline preview retry, copy, and metric-apply interactions with delegated listeners.
- **Frontend Regression Surface**: Reduced the highest-risk share of the SPA monolith by extracting toast/sanitization helpers and PDF preview control logic into isolated modules without forcing a full client rewrite.
- **Undocumented Local Setup Debt**: Removed ambiguity around how to recover from native-module breakage after a Node runtime change by documenting the exact rebuild-first recovery sequence that worked in practice.
- **UX Misdirection / Saved Resumes Rollback**: Permanently removed the dashboard "Your Resumes" workspace and its associated dynamic state indicators ("saved resumes", "future targets"). Consolidated the value-proposition strictly around the immediate "Diagnose & Fix" linear pipeline, eliminating confusing file-picker drop-offs.
- **Stale Claims**: Scrubbed lingering "Upload once, tailor many" claims across the static text, standardizing completely around one-time job targeting.

**Workstream Methodology & Multi-Model Collaboration:**
This comprehensive remediation phase was successfully executed through a synchronized, multi-agent AI effort:
- **Audit & Discovery**: Initiated by a severe Codex and infrastructure budget audit.
- **Strategic Blueprint**: A foundational mitigation roadmap was originally proposed by Gemini, identifying the need for database state resilience.
- **Implementation Design**: The raw plan was subsequently enhanced and corrected through collaborative input (involving Claude 3 Opus and Sonnet intelligence layers), culminating in a hardened remediation plan. This plan pivoted away from Gemini's suggested database migration and instead correctly identified the root cause in the render pipeline (flat-text string replacement vs structured node injection).
- **Execution**: The final rollout was systematically executed step-by-step, validating the infrastructure (Oracle Cloud A1 requirement), strictly structuring the parsing logic, and actively collaborating with the user's ongoing UX feedback to delete the conflicting "Saved Resumes" UI dynamically.

## Timeline: 2026-04-19 (Current)
**Focus:** Historical Reconciliation, Multi-Model Preservation, and Post-Remediation Reality Check

**Implemented (Added):**
- **Session History Preservation**: Updated the canonical docs in `docs/project_history.md` and `docs/TECHNICAL_DOCUMENTATION.md` to preserve the full April 2026 remediation story: the original Codex audit, Gemini's infrastructure/database proposal, Claude Sonnet/Opus plan refinement, the final execution decisions, and the user's follow-up UX constraints.
- **Tab-Order Decision Freeze**: Explicitly recorded the product decision to keep the results information architecture as ATS Diagnosis → Recruiter View → Export Preview → Cover Letter, with Export Preview intentionally staying third and Cover Letter fourth.
- **Infrastructure Planning Record**: Preserved the budget-hosting conclusion from the remediation plan: Playwright/browser rendering makes ultra-low-memory/serverless targets a poor fit, and Oracle Cloud A1 on Ubuntu is the most credible low-cost path if Railway is replaced.
- **Documentation Source-of-Truth Cleanup**: Clarified that the maintained history/reference files now live under `docs/`, not the repository root, and should be updated together whenever scan flow, render behavior, or deployment guidance changes.

**Validated / Still Open:**
- **Resume Template Quality Is Improved, Not Fully Solved**: Post-remediation validation confirmed the new structured-node rewrite order is materially safer than the old flat-text replacement path, but malformed or heavily wrapped resumes can still be split into false experience entries during heuristic structuring/template rendering.
- **Tab Behavior Still Requires Runtime Alignment**: The intended tab order is correct, but the results runtime still needs continued care so default activation logic, button order, pane order, and session persistence all stay aligned with the product decision above.
- **Saved Resume Workspace Remains Rolled Back by Choice**: The "Your Resumes" dashboard experiment remains intentionally removed; the product currently stays focused on the linear diagnose/recruiter/export/cover-letter flow rather than a reusable resume-library model.

## Timeline: 2026-04-19 (Continuation)
**Focus:** Trust-Breaking Flow Remediation, Job-Context Accuracy, Frontend Cleanup, and Full Data Reset

**Implementation Plan Context Preserved:**
- **Multi-Model Plan Consolidation**: Preserved and operationalized the remediation plan synthesized across the earlier Codex audit, Gemini's infra/database proposal, and Claude Sonnet/Opus refinement. The implementation kept the user's explicit tab-order preference intact: `ATS Diagnosis -> Recruiter View -> Export Preview -> Cover Letter`, with Export Preview third and Cover Letter fourth.
- **Execution Strategy**: Chose to repair the highest-trust failures first: scan-form contract, job-context/title/company extraction, keyword false positives, broken resume structuring, results preview reliability, and dashboard clarity before any broader visual experiments.

**Implemented (Added):**
- **Strict Resume Upload Contract**: Reduced accepted upload formats to real resume inputs only (`PDF` and `DOCX`) across the frontend picker, upload middleware, parser path, and validation messaging.
- **Stronger Resume Validation**: Tightened `lib/resume-validator.js` so arbitrary text documents are less likely to pass as resumes. The validator now weighs contact signals, section structure, bullet/date evidence, and negative non-resume signals instead of relying on weak keyword presence alone.
- **Mutually Exclusive Targeting Inputs**: Reworked the scan-page input logic so pasted job descriptions and job-link fetch mode no longer fight each other. Manual JD input now locks the URL field, and a successfully resolved job link now locks the JD textarea.
- **Job-Link UI Fixes**: Fixed the URL-icon positioning bug in the scan form by properly centering the icon inside the input wrapper, and added locked/disabled visual treatment for whichever targeting field is inactive.
- **Improved ATS / Portal Detection Coverage**: Added explicit ATS profiles for `Indeed` and `Cezanne HR` in `lib/jd-processor.js`, allowing portal-aware rendering decisions on links that were previously falling into a vague generic bucket.
- **Better Job Title / Company Derivation**: Hardened title extraction so sentence fragments like `Provide accurate, valid and complete information...` are no longer treated as job titles. Also improved URL and text-based company/title fallback rules to avoid using aggregator hostnames or brittle sentence fragments as recruiter-facing labels.
- **Scraper Metadata Enrichment**: Upgraded `lib/scraper.js` to normalize structured scrape metadata (title/company/location) and enrich generic HTML scrapes with DOM-derived metadata before they reach the job-context pipeline.
- **Keyword False-Positive Guardrails**: Removed unconditional raw `go` and `r` hard-skill matching from `lib/keywords.js` and replaced it with contextual detection (`golang`, `go language`, `R programming`, `RStudio`, etc.), preventing nonsensical missing-keyword output in recruiter view.
- **Resume Structuring Hardening**: Tightened `lib/template-renderer.js` so wrapped bullet continuations are no longer promoted into fake experience headers. This closes one of the remaining causes of malformed ATS resume output in the generated preview.
- **Dashboard Simplification**: Simplified the dashboard information architecture by removing the extra journey/signal panel layer, clarifying the top summary cards, switching momentum from unreliable `job links` counts to targeted scan counts, and sanitizing bad titles before they appear in dashboard/history cards.
- **History / Results Title Cleanup**: Added title-noise filtering in the SPA so recruiter/history surfaces fall back to cleaner role/company labels instead of showing domain names or sentence fragments when older scan data is imperfect.
- **Results Tab Visual Cleanup**: Refined the results-tab chrome to feel lighter and more intentional, with a cleaner active state and less distracting shell emphasis.
- **Projected Score Consistency**: Made the projected-score card behave consistently in results by keeping it visible whenever a match score exists rather than letting it appear/disappear unpredictably.
- **Multi-Format Export Preview Controls**: Re-exposed ATS-safe resume format selection in the Export Preview toolbar (`modern`, `classic`, `minimal`) and wired the frontend selection through preview/download requests so users can compare multiple ATS-friendly resume formats.
- **PDF Preview Reliability Improvement**: Removed the iframe sandbox constraint on the blob-backed PDF preview path and carried the selected template profile into preview URLs, improving inline preview stability and making format comparison possible.
- **Regression Test Expansion**: Extended `tests/core-flow.test.js` to cover:
  - sentence-fragment job-title rejection
  - contextual handling of `go` / `r`
  - wrapped bullet continuation safety
  - explicit ATS detection for Indeed and Cezanne HR
- **PostgreSQL Seeding Support**: Added `db/seed-pg.js` so Supabase/PostgreSQL can be truncated and reseeded with coherent demo accounts and realistic scans rather than being left empty or manually patched.

**Removed / Fixed:**
- **Non-Resume File Acceptance Drift**: Closed the mismatch where the UI and upload middleware still accepted `DOC` and `TXT` even though the product promise and validation flow were already centered on resume uploads.
- **Scan-Form Source Ambiguity**: Removed the user-facing ambiguity where a fetched link and a pasted JD could both be populated and silently compete inside the same scan request.
- **Dashboard Cognitive Overload**: Removed the confusing dashboard "journey" section that duplicated meaning without improving decision quality.
- **Keyword Signal Noise**: Eliminated the specific `go` / `r` false-positive missing-keyword problem visible in recruiter view for retail / non-programming job descriptions.
- **Preview Format Opacity**: Fixed the disconnect where multiple backend templates existed but the live frontend gave the user no way to choose between ATS-safe formats.

**Database Reset / Reseed Performed:**
- **Local SQLite Reset**: Deleted the local SQLite database and reseeded it via `npm run db:reset`. The local dataset now contains fresh demo users plus representative resume/scan/job fixtures instead of carrying stale historical records.
- **Supabase / PostgreSQL Reset**: Truncated the live Postgres application tables (`users`, `resumes`, `scans`, `jobs`, `cover_letters`, `guest_scans`, `scan_sessions`, `download_history`, `stripe_events`, and session storage), then reseeded them using the new `db/seed-pg.js` script.
- **Fresh Accounts Restored**:
  - `demo@resumexray.pro / demo1234`
  - `pro@resumexray.pro / pro12345`
  - `hustler@resumexray.pro / pro12345`

**Verification Completed:**
- **Static Verification**: `npm run syntax:frontend` plus direct `node -c` checks passed for the touched backend files.
- **Automated Tests**: `npm test` passed fully (`24/24`).
- **Browser Verification (local on port 3367)**:
  - dashboard loads with the journey grid removed
  - scan page locks the URL field when a pasted JD is present
  - scan-page job-link status correctly reflects pasted-JD mode
  - results page honors template switching in Export Preview
  - preview URLs now carry explicit template selection
  - projected score remains visible in results once a match score exists

**Still Open / Residual Notes:**
- **External Job-Site Variability Remains**: Indeed, LinkedIn, and custom portals can still partially degrade when remote anti-bot controls change. The scraper/job-context path is materially better now, but it still depends on third-party HTML staying accessible.
- **Resume Output Quality Is Improved, Not Finished**: The wrapped-bullet/header bug is mitigated, but the broader resume-generation system still deserves deeper cleanup if the goal is consistently premium output across badly structured source resumes.

## Timeline: 2026-04-20
**Focus:** Results-Workspace UI Refinement, Scan-Field Polish, and Documentation Reconciliation

**Implemented (Added):**
- **Results Tab Polish Pass**: Refined the results-workspace tab bar to feel more like a deliberate control surface and less like stacked generic buttons. The active state, spacing, icon alignment, and responsive layout were tightened while keeping the agreed tab order intact: `ATS Diagnosis -> Recruiter View -> Export Preview -> Cover Letter`.
- **Tab Copy Cleanup**: Shortened the sublabels beneath each tab so they read as operational cues instead of marketing copy:
  - `Rules & gaps`
  - `Search fields`
  - `PDF + DOCX`
  - `Targeted draft`
- **Scan URL Input Spacing Pass**: Increased left padding on the scan-page URL field so the link icon can no longer visually crowd the placeholder text.
- **Dashboard Render Cleanup**: Removed the leftover `updateDashboardJourney(...)` call from the live dashboard render path after the journey panel had already been deleted from the markup, reducing dead UI coupling.
- **Documentation Sync**: Updated both canonical docs again so the Apr 20 frontend follow-up is preserved alongside the larger Apr 19 trust-remediation work.

**Verified:**
- `npm run syntax:frontend` passed
- `npm test` passed fully (`24/24`)
- local app boot on `http://localhost:3367` remained healthy after the follow-up pass

**Still Open / Residual Notes:**
- **Resume generation quality still needs deeper iteration**: The UI is cleaner and the pipeline is safer, but the strongest remaining product risk is still inconsistent resume quality on messy source documents.
- **Live scraping remains probabilistic**: Indeed / Cezanne / custom-job-board extraction is improved, but third-party markup drift can still weaken job-title/company recovery without warning.

## Timeline: 2026-04-20 (Resume Export Follow-up)
**Focus:** Resume Layout Quality, Experience-Aware Page Budgeting, and Honest Missing-Skill Injection

**Implemented (Added):**
- **Export Layout Rework**: Tightened the resume PDF templates (`modern`, `classic`, `minimal`) so the exported CV reads like a cleaner recruiter-facing document instead of a loose browser printout. The pass improved:
  - title / company / date alignment
  - bullet indentation and spacing
  - section spacing and hierarchy
  - overall line density for ATS-safe PDF output
- **Experience-Aware Page Budget**: Replaced the temporary hard one-page requirement with a more realistic rule:
  - resumes with `<= 3 years` effective experience target **1 page**
  - resumes with `> 3 years` effective experience may validate at **up to 2 pages**
- **Render Validation Tightening**: The PDF render validator now enforces the dynamic page budget instead of allowing all resumes to pass at 2 pages by default.
- **DOM-Level Export Fit Pass**: Added a final PDF-only fit stage that progressively tightens spacing and trims low-priority content only when the export exceeds its allowed page budget.
- **Honest Skill Injection from Keyword Plan**: Wired `keywordPlan` into `buildResumeData()` so recruiter-view missing-skill suggestions are no longer diagnostics only. Honest `Skills` recommendations now get merged conservatively into the exported skills section, while dishonest suggestions (`honest: false`) are skipped.
- **Summary Injection Guardrail**: Honest summary-level keyword suggestions can be appended conservatively when they do not duplicate the existing summary.

**Verified:**
- `npm test` passed fully at `26/26`
- generated PDF preview validation confirmed:
  - `modern` template
  - `standard` density
  - `pageCount: 1` for an early-career sample
- local artifact review confirmed the updated PDF uses tighter indentation, cleaner hierarchy, and better one-page composition

**Product Clarification Preserved:**
- Missing skills are **not** blindly stuffed into the resume.
- Only keyword-plan items marked as honest are eligible for insertion, and the current automatic insertion is conservative and centered on the `Skills` section first.

## Timeline: 2026-04-21 (Hafiz Resume Parser / Export Fix)
**Focus:** Two-Column PDF Recovery, Safer Experience Structuring, and Honest Resume Export Output

**Implemented (Added):**
- **Layout-Aware PDF Parsing for Two-Column Resumes**: Replaced the old linear `pdf-parse` path in `lib/parser.js` with a custom `pagerender` flow that groups text by row, splits rows into spans, detects left/right column clusters, and serializes content in recruiter-reading order. This specifically addressed resumes like Hafiz Talha Naseem’s where the old parser was mixing left-column experience bullets with right-column skills/strengths content.
- **Header Extraction Tightening**: Reworked `parseSectionsAdvanced(...)` and related helpers in `lib/resume-builder.js` so the top-of-resume header is parsed more deliberately. The builder now:
  - detects the actual name instead of assuming line 1 is always safe
  - separates contact lines from short role/headline lines
  - preserves a clean explicit headline like `Fullstack developer with 3 years of experience`
  - isolates `Strengths` as its own section instead of leaking it into `Projects` or `Skills`
- **Summary Fallback Guardrail**: Updated `polishProfessionalSummary(...)` so short, honest source headlines are no longer overwritten by a generic fallback summary. If the uploaded resume already contains a concise role/value line, the export now keeps that instead of inventing bland copy.
- **Experience Header Heuristic Cleanup**: Tightened `structureExperience(...)` in `lib/template-renderer.js` so wrapped continuation lines like `HTML, CSS, React), contributing to multiple high-impact client projects` are no longer promoted into fake roles. New entries now strongly prefer explicit date support or a real role/company pattern.
- **Trim Logic Continuation Fix**: Fixed `trimForSinglePage(...)` so when a lower-priority bullet is trimmed, its wrapped continuation lines are also dropped. Before this, skipped bullets could still leak their continuation lines into the previous kept bullet and produce obviously broken exported experience content.
- **Education Grouping Fix**: Reworked `structureEducation(...)` so wrapped degree/school lines are grouped until the date line, preserving school/degree pairing on PDF exports from multi-line source resumes.
- **Failed Rewrite Rejection**: `applyBulletRewrites(...)` now ignores optimized bullets whose `contextAudit.passed === false`, preventing low-trust AI rewrites from slipping into exports even when they were already marked unsafe by the rewrite pipeline.
- **Regression Coverage Added**: Added new `tests/core-flow.test.js` cases that specifically lock in:
  - no fake experience-entry creation from comma-heavy wrapped bullet lines
  - no replacement of a clean source headline with a generic fallback summary
- **Refined Template Export Wiring Fixed**: Corrected the production export path so `refined` is accepted by both `routes/agent.js` and `generatePDF(...)` in `lib/resume-builder.js`. Before this fix, the UI could present `Refined` as selected while the backend silently rendered the `modern` template instead.

**Verified:**
- `node --check lib/parser.js`
- `node --check lib/resume-builder.js`
- `node --check lib/template-renderer.js`
- `node --check routes/agent.js`
- `node --test tests/core-flow.test.js` passed fully after the follow-up refined-template regression was added
- local render review of Hafiz Talha Naseem’s source PDF confirmed:
  - no hallucinated Spark/data-pipeline bullet
  - no `Strengths` leakage into `Projects`
  - no fake second TechGenies entry from wrapped bullet text
  - no literal `**metric**` markdown leakage in the rendered PDF
  - `refined` direct output now differs correctly from `modern`, and `generatePDF({ template: 'refined' })` now actually renders the refined layout instead of silently downgrading

**Still Open / Residual Notes:**
- **Tag-style skills are still plain-text, not chip-like**: the export is now structurally honest, but dense right-column skill tags still flatten into plain ATS-safe text rather than a more polished grouped representation.
- **One-page bias still trims some valid content**: for early-career resumes exported into single-column ATS-safe templates, the renderer still trims lower-priority later bullets to stay within the one-page budget. That tradeoff is now cleaner, but it is still a deliberate tradeoff rather than perfect source preservation.

## Timeline: 2026-04-21
**Focus:** Export Resume Quality Upgrade, Template Defaults, and Documentation Discipline

**Implemented (Added):**
- **Refined Resume Template Added**: Introduced a new `refined` ATS-safe resume template aimed at stronger visual hierarchy and more polished recruiter-facing output without relying on layout tricks that weaken ATS parsing.
- **Preview Format Control Expanded**: Added `Refined` to the Export Preview format selector so users can compare a higher-quality default format directly in the results workspace.
- **Higher-Quality ATS Defaults**: Reworked ATS template defaults in `lib/jd-processor.js` so the system now prefers `refined` or `classic` at `standard` density for most platforms instead of falling into `minimal` / `compact` too early.
- **Render Attempt Reordering**: Updated `lib/render-service.js` so preview/export generation now attempts higher-quality standard-density layouts before compact fallback passes. The practical effect is that the renderer now tries to preserve readable hierarchy before shrinking.
- **Professional Summary Polishing**: Added a deterministic summary-polish step in `lib/resume-builder.js` so the exported resume no longer relies only on whatever weak summary text survived parsing. When the source summary is poor or absent, the pipeline now builds a cleaner fallback summary from role, experience, and skill signals.
- **Documentation Process Clarified**: From this point forward, implementation work is expected to update both `docs/project_history.md` and `docs/TECHNICAL_DOCUMENTATION.md` in the same change set so product behavior and historical context remain aligned.

**Verified:**
- `node --check public/js/app.js`
- `node --check lib/jd-processor.js`
- `node --check lib/render-service.js`
- `node --check lib/resume-builder.js`
- `npm test -- --runInBand tests/core-flow.test.js` passed fully

**Still Open / Residual Notes:**
- **Bullet rewriting is still the next major quality lever**: This pass improved summary quality and template selection, but the strongest remaining resume-quality risk is still uneven bullet rewriting on messy source resumes.
- **Live visual review is still required**: Automated PDF validation passed, but export quality should still be checked against several real scans to tune whitespace, role density, and section tradeoffs before claiming the output is fully premium.

## Timeline: 2026-04-21 (DOCX Export Contract Tightening)
**Focus:** Template-Aware Word Exports Without Changing the Current Architecture

**Implemented (Added):**
- **DOCX Template Awareness Added**: Updated `generateDOCX(...)` in `lib/resume-builder.js` so Word exports now accept template and density options instead of always emitting one generic layout.
- **ATS-Safe Theme Mapping for DOCX**: Added deterministic DOCX theme profiles that stay single-column and parser-safe while looking materially closer to a paid resume deliverable:
  - `refined` -> professional Word-style theme
  - `modern` -> blue-accent modern theme
  - `classic` -> serif black-and-white theme
  - `minimal` -> compact theme
- **No Architecture Rewrite**: Kept the current parser / builder / download stack intact. This was done as an export-layer improvement, not a new document subsystem.
- **Download Route Wiring Fixed**: Updated `routes/agent.js` so DOCX downloads now honor:
  - the user-selected template
  - the selected density
  - the ATS-profile template/density defaults when the user does not override them
- **Hierarchy Upgrade for Word Exports**: Reworked the DOCX builder output to improve:
  - header typography
  - section divider treatment
  - role / company / location grouping
  - right-aligned date lines
  - compact density behavior for tighter ATS-safe exports
- **Cover Letter DOCX Path Stabilized**: Added a simple template-aware cover-letter DOCX path so the new DOCX options handling does not regress non-resume downloads.
- **Regression Coverage Added**: Added a DOCX regression test in `tests/core-flow.test.js` that opens the generated `.docx` ZIP and asserts that the requested theme actually changes the emitted Word XML.

**Why This Mattered:**
- PDF exports were already template-aware, but DOCX exports were effectively one-style-fits-all.
- That meant users could choose a format in the product and still receive a bland Word file that ignored the selection.
- This pass makes DOCX part of the actual paid value instead of a fallback artifact.

**Verified:**
- `node --check lib/resume-builder.js`
- `node --check routes/agent.js`
- `node --test tests/core-flow.test.js` passed fully with the new DOCX-theme regression included

**Still Open / Residual Notes:**
- **This improves the container, not the content model**: The Word export now respects the selected ATS-safe theme, but the next deeper quality win is still improving how bullets and summaries are authored from messy source resumes.
- **Visual review against real uploads still matters**: The DOCX structure is materially better and now deterministic, but template polish should still be reviewed against several real customer resumes before making stronger premium claims.
