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

## Timeline: 2026-04-22
**Focus:** Document Quality & Export Integrity Overhaul

**Implemented (Added):**
- **Expanded Resume Families**: Added two new ATS-safe export families, `Executive` and `Corporate`, alongside the existing `Refined`, `Modern`, `Classic`, and `Minimal` options. Wired them through HTML templates, DOCX themes, preview selection, and download requests.
- **Exact-Variant Export Billing**: Changed export credit idempotency so one credit now unlocks only the exact chosen variant:
  - scan
  - document type
  - file format
  - template family
  - density
  This preserves free re-downloads for the same variant while charging again for a different style or file type.
- **Cover Letter / Resume Style Linking**: Made cover-letter preview and export inherit the currently selected resume family so both documents now read as one coherent set instead of two disconnected products.
- **Shared Document Workspace Chrome**: Reworked the Cover Letter tab to use the same toolbar / preview-frame / bottom export-bar language as Export Preview, removing the previous ad hoc iframe wrapper and mismatched shell treatment.
- **Job Context Recovery Hardening**: Tightened fallback JD parsing so headings like `Full job description` no longer become the role, company intros like `Lock Doctor are ...` are recognized correctly, and aggregator hostnames such as `ie.indeed.com` are suppressed as employer names.
- **Keyword Trust Guardrails**: Rebuilt keyword detection around boundary-aware matching so substrings like `escalated`, `rapid`, and `excellent` no longer surface fake hard skills like `scala`, `api`, or `excel`.
- **Requirement-Tier Filtering**: Added requirement-section awareness (`Responsibilities`, `Essential Requirements`, `Desirable Requirements`) so ATS diagnosis and recruiter-view keyword gaps stay focused on higher-confidence requirements.
- **Trust-First Resume Mutation Policy**: Stopped letting raw missing-keyword output directly mutate exported resumes. Keyword-plan additions are now restricted to resume-evidenced terms, and summary polishing no longer injects JD-only skills.
- **Cover Letter Generation Cleanup**: Replaced the old numbered / markdown-heavy cover-letter prompt with a structured paragraph-based prompt, and stripped placeholder role/company values from both prompt context and parsed render output.
- **LinkedIn Avatar Recovery**: Added `lib/oauth-profiles.js` to normalize LinkedIn OIDC avatar payloads across multiple response shapes, and updated OAuth login/linking so valid provider avatars now overwrite stale values instead of getting blocked by `COALESCE` logic.

**Removed / Fixed:**
- **Broken Placeholder Headers**: Eliminated `Re: Full job description` and `ATS-Optimized` leakage from generated cover letters.
- **False Keyword Diagnosis**: Removed the substring-driven recruiter-view/ATS-diagnosis bug that was surfacing irrelevant missing skills for customer-service and operations roles.
- **Template Default Drift**: Reset frontend and backend defaults to `Refined` instead of continuing to fall back to older `Modern` assumptions in preview/export state.
- **Cover Letter UI Mismatch**: Closed the visual gap where Cover Letter and Export Preview looked like unrelated products.

**Verification Completed:**
- `node --check config/passport.js`
- `node --check lib/jd-processor.js`
- `node --check lib/keywords.js`
- `node --check lib/resume-builder.js`
- `node --check lib/template-renderer.js`
- `node --check public/js/app.js`
- `node --check routes/agent.js`
- `node --test tests/core-flow.test.js`

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

## Timeline: 2026-04-21 (Profile Reliability & Email Observability)
**Focus:** Profile CTA Cleanup, Avatar Upload Stability, and Mail Delivery Diagnostics

**Implemented (Added):**
- **Profile Banner CTA Simplified**: Removed the redundant secondary `View Dashboard` button from the profile momentum card so the profile page now presents one clear primary next step instead of two competing dashboard CTAs.
- **Runtime Upload Directory Added**: Introduced `lib/uploads.js` to resolve a dedicated writable uploads root. Local development still defaults to `public/uploads`, while production now uses a runtime-safe uploads directory (or `UPLOADS_DIR` if explicitly configured) without changing the public `/uploads/...` URL shape.
- **Avatar Storage Path Hardened**: Updated `routes/user.js` and `server.js` so avatar uploads are written to the runtime uploads directory and served explicitly from `/uploads`. The upload route now also cleans up old locally stored avatars through the shared path resolver instead of assuming the files live under the compiled `public/` tree.
- **Avatar Failure Stages Split Out**: Broke the avatar route failure handling into clearer write-stage and database-stage branches, with cleanup when DB persistence fails after a file write. This turns a vague generic failure into a safer, more diagnosable path.
- **Email Delivery Logging Improved**: Extended `lib/mailer.js` with recipient-domain logging so verification, password reset, and SSO reminder sends now record the delivery domain (`yahoo.com`, `gmail.com`, etc.) alongside the provider message id and active transport. This does not prove inbox placement, but it makes it easier to confirm whether the app handed the message to Resend successfully.
- **Regression Coverage Added**: Added tests covering the single dashboard CTA in the profile banner, safe upload-url path resolution, and recipient-domain extraction for mail logs.

**Verified:**
- `node --check server.js`
- `node --check routes/user.js`
- `node --check lib/uploads.js`
- `node --check lib/mailer.js`
- `npm test`
- local signup/login/avatar-upload flow against the running app confirmed the avatar endpoint now returns a successful upload response and serves the new image from `/uploads/avatars/...`

**Still Open / Residual Notes:**
- **Avatar files remain runtime-local, not object storage backed**: uploads now use a safer writable directory, but they are still ephemeral on platforms like Railway until a durable object store is added.
- **Accepted email != inbox placement**: the app can now log that Resend accepted mail for `yahoo.com`, but inbox vs spam vs user-side blocking still needs Resend event visibility or recipient mailbox verification.

## Timeline: 2026-04-23 (DOCX Resume Reconstruction Repair)
**Focus:** Stop DOCX-derived resumes from flattening into malformed exports

**Implemented (Changed):**
- **Header Noise Suppression Added**: Updated `lib/resume-builder.js` so decorative header lines like `Master CV`, `Ireland Tech Roles`, and tag-cloud style lines such as `Engineering | Data | Technical Support` no longer leak into:
  - contact info
  - summary text
  - exported document headers
- **Explicit Summary Sections Now Win**: When the uploaded resume already contains a real `PROFILE` / `SUMMARY` section, header-level title lines are no longer concatenated into that section. This prevents polluted summaries like `Software Engineer and Data Analyst Master CV ...`.
- **Section Alias Coverage Expanded**: Added parsing support for additional real-world section labels, including:
  - `CORE SKILLS`
  - `KEY SKILLS`
  - `SELECTED IMPACT`
  - `ACHIEVEMENTS` / `HIGHLIGHTS` style variants
- **Selected Impact Preserved End-to-End**: Wired `strengths` / `selected impact` through:
  - `lib/resume-builder.js`
  - `lib/template-renderer.js`
  - all ATS-safe resume templates
  so export PDFs and DOCX files no longer drop or misplace quantified impact lines.
- **DOCX Paragraph-to-Bullet Reconstruction Improved**: Updated `lib/template-renderer.js` so sentence-style role paragraphs from DOCX resumes are converted into clean bullets without requiring explicit bullet glyphs. This specifically fixes resumes where each accomplishment is a separate paragraph rather than a `•` list item.
- **Location Lines Reattached Correctly**: Standalone lines like `Lahore, Pakistan (Hybrid)` and `Remote` are now recognized as entry locations instead of being absorbed into bullets or summary text.
- **Education Pairing Fixed**: Degree lines such as `MSc, Data Analytics` now pair correctly with school/date lines like `Technological University of the Shannon | 2024` instead of rendering as malformed school/date output.
- **Project Descriptions Reattached to Their Titles**: Project description sentences now stay inside the correct project entry rather than becoming fake standalone project names.
- **Regression Coverage Added**: Added a DOCX-style reconstruction test to `tests/core-flow.test.js` that locks in:
  - clean contact extraction
  - unpolluted summary output
  - separate `skills` and `selected impact` sections
  - proper project and education structure
  - rendered HTML containing the `SELECTED IMPACT` section

**Why This Mattered:**
- The supplied CV/JD case showed the export pipeline was not failing because LinkedIn JD detection broke.
- The real defect was that DOCX-derived line structure was being flattened and then reconstructed too loosely, which caused:
  - summary/header pollution
  - skills merging into experience
  - impact metrics disappearing into the wrong role
  - education rendering as broken title/date pairs
- This pass repairs the exported document structure without changing the overall architecture or requiring a schema migration.

**Verified:**
- `node --check lib/resume-builder.js`
- `node --check lib/template-renderer.js`
- `node --test tests/core-flow.test.js`
- local parse/render validation using `/Users/ghasmir/Downloads/ghasmir_ahmad_master_cv_ireland_tech.docx`
- local PDF text extraction confirmed the repaired export now contains:
  - clean contact line
  - clean professional summary
  - separated `CORE SKILLS`
  - separated `SELECTED IMPACT`
  - correctly paired education entries

**Still Open / Residual Notes:**
- **Content targeting quality remains separate from structural repair**: this pass fixes malformed export structure, but it does not by itself guarantee the role-targeting decisions or summary emphasis are ideal for every JD.
- **Highly stylized source resumes are still heuristic inputs**: this repair materially improves DOCX reconstruction, but resumes with heavy tables, text boxes, or unconventional heading systems can still require future parser hardening.

## Timeline: 2026-04-23 (Preview Shell Stability and Paper-Fit Repair)
**Focus:** Stop preview rerender thrash and make one-page previews fit like paper

**Implemented (Changed):**
- **Same-Variant Preview Deduping Added**:
  - updated `public/js/modules/pdf-preview.mjs`
  - updated `public/js/app.js`
  so revisiting `Export Preview` or `Cover Letter` with the same scan id, template, and density no longer forces another fetch/render cycle.
- **PDF Preview Height Stabilized**:
  - the PDF canvas container now receives an explicit runtime height
  - single-page PDF previews are scaled against available preview height instead of always expanding to the widest allowed width
- **Cover Letter Preview Sizing Reworked**:
  - removed the old “stretch iframe to document scroll height” behavior
  - cover-letter previews now fit to an A4 paper ratio inside the preview shell
  - iframe previews are centered and bounded like a real sheet instead of filling the whole pane width
- **A4 Screen Sheet Added**:
  - updated `lib/templates/cover-letter.html`
  - the cover-letter preview now renders inside a dedicated `letter-sheet` wrapper sized to `210mm x 297mm` on screen
  - print/PDF output remains controlled by print styles
- **Preview Surface Styling Tightened**:
  - updated `public/css/styles.css`
  - the preview background now behaves like a paper stage
  - the cover-letter iframe gets a visible sheet boundary and no longer feels clipped into the pane

**Why This Mattered:**
- Users were seeing two linked problems:
  - the preview tabs looked like they were rendering repeatedly
  - single-page previews did not visually fit as a full paper page
- The underlying issues were redundant reloads for unchanged preview variants and width-first sizing that ignored paper height.

**Verified:**
- `node --check public/js/app.js`
- `node --check public/js/modules/pdf-preview.mjs`
- `node --check lib/template-renderer.js`
- `node --test tests/core-flow.test.js`
- direct template render validation confirmed the cover-letter HTML now emits the `letter-sheet` A4 preview wrapper

**Still Open / Residual Notes:**
- **Full browser validation still needs a concrete saved scan**: local code and render checks passed, but a true end-to-end visual pass of the live preview tabs still depends on real scan data in the running app.
- **Multi-page resume previews still scroll by design**: this pass improves one-page fit, not multi-page “show every page at once” behavior.

## Timeline: 2026-04-23 (Mobile Responsiveness Audit and Preview Surface Repair)
**Focus:** Verify the full site on phone breakpoints and fix the remaining mobile and preview-surface defects

**Implemented (Changed):**
- **Whole-Site Mobile Audit Completed**:
  - verified the public routes at `390px` and `320px` widths:
    - landing
    - pricing
    - scan
    - login
    - signup
    - privacy
    - terms
  - seeded a local guest scan so `/results/:id` could be checked with real tabs, previews, and export bars at phone width.
- **Hidden Mobile Nav State Hardened**:
  - updated `public/index.html`, `public/js/app.js`, and `public/css/styles.css`
  - the bottom-sheet menu now starts closed with `aria-hidden="true"` and `inert`
  - closed state also uses `visibility: hidden` and `pointer-events: none`
  - this removes the hidden-menu bleed-through in full-page captures and keeps offscreen menu content out of the active accessibility tree.
- **Phone-Sized Template Picker Fixed**:
  - updated `public/css/styles.css`
  - the six export styles no longer overflow horizontally on phones
  - the style pills now render as a `3 x 2` grid on small screens, so all paid export families remain visible and tappable.
- **Cover-Letter Preview Now Renders as a Real Document**:
  - updated `config/security.js`
  - updated `public/js/app.js`
  - `X-Frame-Options` now uses `SAMEORIGIN`, which aligns with the existing CSP `frame-ancestors 'self'` policy and permits first-party preview iframes
  - historical results now route cover letters through the document-preview path instead of forcing the plain-text stream view
  - the cover-letter iframe wrapper is now built with DOM nodes instead of `safeHtml(...)`, which previously stripped the iframe out before mount.
- **Cookie Banner Mobile Footprint Reduced**:
  - updated `public/css/styles.css`
  - the first-visit consent panel now uses tighter mobile spacing, a shorter max-height, and sticky action buttons so it does not dominate the viewport on smaller screens.

**Why This Mattered:**
- The mobile pass exposed issues that desktop review would not clearly surface:
  - the hidden nav sheet still behaved like a live dialog while offscreen
  - the cover-letter tab could remain stuck in its loading skeleton
  - the six-style selector overflowed and hid one export option on phones
  - the cookie banner consumed too much vertical space on first load
- These were usability issues, not just visual polish problems, because they affected export selection, preview reliability, and page stability on mobile.

**Verified:**
- `node --check public/js/app.js`
- `node --check config/security.js`
- `node --test tests/core-flow.test.js`
- Playwright verification on:
  - public routes at `390px` and `320px`
  - seeded `/results/1` at `390px`
  - export preview with all six styles visible
  - cover-letter preview rendering through a live iframe-backed document view
- `curl -I /api/agent/cover-letter-preview/:scanId` now returns `X-Frame-Options: SAMEORIGIN`

**Still Open / Residual Notes:**
- **Full-page screenshot tools can still duplicate sticky chrome in the exported artifact**: that is a Playwright capture quirk, not a viewport rendering defect in the live UI.
- **Authenticated dashboard/profile flows still deserve a separate signed-in phone pass**: the public site and seeded results workspace were verified here, but logged-in account pages were not exercised with a real user session in this pass.

## Timeline: 2026-04-24
**Focus:** Comprehensive Engineering Audit & Remediation

**Implemented (Added):**
- **Critical XSS Patch**: Implemented `escape-html` library in `lib/template-renderer.js` to HTML-escape user input before processing with `boldMetrics` Handlebars helper, mitigating XSS vulnerability in PDF generation.
- **Frontend Technical Debt Cleanup**: Removed inactive modular frontend code (`src/` and `_agents/` directories) and obsolete build configuration files (`vite.config.js`, `tailwind.config.js`, `postcss.config.js`, `tsconfig.json`).
- **UI Rendering Hardening**: Enhanced `safeHtml` fallback in `public/js/app.js` to strip all HTML tags if `DOMPurify` is unavailable, preventing raw HTML injection.

**Removed / Fixed:**
- **XSS Vulnerability**: Eliminated a critical Cross-Site Scripting vulnerability in the PDF rendering pipeline.
- **Legacy Frontend Code**: Removed `src/` and `_agents/` directories, along with associated build artifacts, simplifying the frontend architecture.

## Timeline: 2026-04-24 (Phase 1 UI/UX Accessibility and Readability Pass)
**Focus:** Motion safety, touch-friendly interactions, contrast/readability floor, and Safari compositing guard

**Implemented (Changed):**
- **Global `prefers-reduced-motion` Guard Added**:
  - updated `public/css/styles.css`
  - added a comprehensive `@media (prefers-reduced-motion: reduce)` block that suppresses all CSS animations, transitions, and `scroll-behavior` for users who request reduced motion
  - the block explicitly neutralizes `.animate-fade-up`, `.premium-glow`, `@keyframes pulse-dot`, `@keyframes blink`, and `@keyframes toastSlideIn`
  - this replaces the previous narrow reduced-motion rule that only affected `.mobile-toggle-inner span`
- **Card Hover Transforms Made Touch-Safe**:
  - removed `transform: translateY(...)` from `.card:hover`, `.card-elevated:hover`, `.step-card:hover`, `.pricing-card:hover`, `.btn-primary:hover`, `.results-tab-btn:hover`, and `.scan-history-card:hover`
  - moved all hover transforms into a single `@media (hover: hover) and (pointer: fine)` block so they only activate on pointer devices
  - touch devices now see border/shadow/color hover feedback without sticky "lifted" states
- **Placeholder Contrast Raised**:
  - changed `.form-group input::placeholder` from `var(--text-faint)` to `var(--text-secondary)` for improved readability
  - changed `.jd-textarea::placeholder` from `var(--text-muted)` to `var(--text-secondary)`
- **Small-Text Floor Raised**:
  - raised `--text-overline` token from `0.6875rem` (11px) to `0.75rem` (12px)
  - raised `.hero-proof-kicker` from `0.6875rem` to `0.75rem`
  - raised `.proof-kicker` from `0.675rem` to `0.75rem`
  - raised `.proof-label` from `0.84rem` to `0.875rem`
  - raised `.hero-proof-card span:last-child` from `0.8125rem` to `0.875rem`
  - raised `.badge` from `0.6875rem` to `0.75rem`
  - raised `.ring-label` and `.ring-sub` from `0.625rem` to `0.6875rem`
  - raised `.footer-bottom` from `0.7rem` to `0.8125rem`
  - raised `.footer-disclaimer` from `0.75rem` to `0.8125rem`
  - standardized `.body-sm` from `0.9375rem` (15px) to `0.875rem` (14px)
- **Hero Leading Opened**:
  - changed `.hero-title` from `clamp(2.5rem, 7vw, ...)` with `line-height: 1.05` to `clamp(2rem, 6vw, ...)` with `line-height: 1.12`
  - improves readability for stressed job-seekers and small viewports
- **`.nav-cta:hover !important` Removed**:
  - the `!important` on `.nav-cta:hover` background was a cascade smell
  - replaced with a higher-specificity `a.nav-cta:hover, .nav-cta:hover` rule with no `!important`
- **iOS Safari Blur Compositing Guard**:
  - added `will-change: transform`, `-webkit-transform: translateZ(0)`, and `transform: translateZ(0)` to `.topbar`
  - promotes the sticky navbar to its own compositor layer, preventing the known Safari flicker when the address bar collapses during scroll

**Verified:**
- `npm run syntax:frontend` passed
- `npm test` passed (40/40)
- visual check at 390px and 1200px: landing, scan, results, dashboard, pricing all render correctly
- `prefers-reduced-motion: reduce` active: no animations anywhere on the page
- `@media (hover: hover)` guard confirmed: hover lifts only appear on pointer devices

**Still Open / Residual Notes:**
- **Phase 2 (UX flow improvements) and Phase 3 (CSS architecture split) remain to be implemented**: this pass covers only the P1 accessibility and readability quick wins.
- **Full `@media (prefers-reduced-motion)` coverage for JS-driven animations** (toast slide-in, count-up, progress dots) is now declaratively suppressed via CSS — JS-driven DOM animations still fire but produce no visible movement because their CSS properties are forced to near-zero duration.

---

## 2026-04-24 (Phase 2 — UX Flow Improvements)

**Scope:** All 9 Phase 2 items from the Senior Frontend Designer audit.

**Changes across `public/index.html`, `public/css/styles.css`, `public/css/app-surfaces.css`, `public/js/app.js`:**

1. **Scan Page: Segmented Toggle for URL vs JD Input**
   - replaced the mutual-locking two-input layout (URL + JD textarea) with a segmented toggle (`Job URL` / `Paste Description`) that shows one input panel at a time
   - removed `.job-details-hint` element and CSS rule; toggle itself serves as mode indicator
   - added `.job-source-toggle`, `.job-source-toggle-btn`, `.job-source-panel` CSS classes in `styles.css`
   - added `setupJobSourceToggle()` and `switchJobSourceMode()` JS functions
   - updated `syncTargetInputState()` to respect active toggle mode (no locking in JD mode)
   - form validation error messages now context-aware per active mode
   - `.scan-col-job-details:not(.is-active)` progressive disclosure now includes `.job-source-toggle` and `.job-source-panel`

2. **Results: Session-Based Masthead Compression**
   - added `viewedResultsSessions` `Set` to track which scan IDs have been viewed in the current session
   - on first view, masthead shows full layout; on re-visits within the same session, `.is-compact` class is added
   - compressed state hides `.results-masthead-body`, reduces padding and title size via CSS in `app-surfaces.css`

3. **Results: Priority Card Severity Accent Border**
   - added `data-severity` attribute (`critical` / `warning` / `good` / default) to `.results-summary-priority`
   - added CSS `border-left` color per severity: `var(--red)` for critical, `var(--amber)` for warning, `var(--green)` for good
   - JS `updateResultsSummary()` now computes severity alongside title/body text

4. **Dashboard: Re-Scan Shortcut**
   - added a `Re-scan` ghost button (`btn-ghost btn-sm`) to each scan history card, hidden by default and revealed on hover
   - on mobile (≤768px), re-scan button is always visible
   - added `.scan-history-rescan` CSS with opacity transition
   - uses `data-action="navigate" data-path="/scan"` for delegated routing

5. **Profile: Dynamic Momentum CTA**
   - added `scansUsed === 0` branch to `updateProfileMomentum()`: unverified → verify, 0 scans → start scan, low credits → buy, else → open dashboard
   - each branch sets appropriate title, body, CTA text, and navigation path

6. **Colorblind-Safe Status Icons in Recruiter Cards & Summary Strip**
   - added SVG shape icons (checkmark ✓, warning ⚠, cross ✗) next to status text in `.recruiter-signal-status`
   - added matching SVG icons in `.recruiter-overview-stat` for Captured/Partial/Missing counts
   - added `.recruiter-status-icon` CSS class with per-status color variants

7. **Score Ring `aria-label` and Route Change Announcements**
   - `animateGauge()` now sets `aria-label` and `role="img"` on the parent `.score-gauge` SVG when a value is rendered
   - added route label map to `navigateTo()` that announces page changes via `#sr-announcer` live region

8. **Credit Cost Micro-Interaction Near Export Buttons**
   - added `1 credit` hint badge inside Download PDF and DOCX buttons (`.download-cost-hint`)
   - hint is hidden by default (`opacity: 0`), revealed on hover/focus, always visible on mobile
   - added CSS transition and mobile override

9. **Warm Empty States with SVG + CTA**
   - replaced bare search-circle icon in dashboard empty state with a targeted document+search illustration
   - warmed up copy: "Your first scan starts here" headline, expanded body text, larger SVG icon
   - increased bottom margin on CTA button for better spacing

**Verified:**
- `npm run syntax:frontend` passed
- `npm test` passed (40/40)

**Still Open:**
- Progressive migration of hardcoded `font-size` values to `var(--text-*)` tokens (incremental, not blocking)

---

## 2026-04-24 (Phase 3 — CSS Architecture & Polish)

**Scope:** CSS architecture cleanup, design token consolidation, favicon and dependency improvements.

**Changes across `public/css/tokens.css` (new), `public/css/styles.css`, `public/css/app-surfaces.css`, `public/js/app.js`, `public/index.html`, `docs/FRONTEND_ARCHITECTURE.md`:**

1. **CSS Token Extraction**: Extracted `@font-face` declarations and `:root` design tokens (colors, spacing, typography, motion, shadows, radii) into a dedicated `tokens.css` file. This file must load before `styles.css`. Updated `index.html` to include `<link rel="stylesheet" href="/css/tokens.css?v=1.0">` as the first stylesheet. Updated `FRONTEND_ARCHITECTURE.md` to reflect the new file. Removed the equivalent content from `styles.css` (lines 32–182), replacing with a header comment noting that tokens live in `tokens.css`.

2. **Merged `--bg-deep` / `--bg-base`**: Removed the unused `--bg-base: #0e0e14` token. Only `--bg-deep: #0a0a0f` was referenced in the codebase (4 usages in `styles.css`). The two values were close enough that merging to a single variable eliminates confusion.

3. **Typography Scale Standardization**: Added three new design tokens to the `:root` scale: `--text-sm: 0.8125rem` (13px, compact labels), `--text-xs: 0.6875rem` (11px, micro labels), and `--text-2xs: 0.625rem` (10px, badge minimums). These formalize sizes that were already in use as hardcoded values throughout the CSS.

4. **Unified Accent Family for Credits Badge**: Changed `.credits-badge` and `.premium-glow` from the divergent purple `#a855f7` / `rgba(168, 85, 247)` to the app's accent family `#635bff` / `rgba(99, 91, 255)`. This includes:
   - `.credits-badge` background, border, hover state, and text color
   - `@keyframes pulse-glow` shadow colors
   - `.verify-banner` gradient and border

5. **Replaced Emoji Favicon with SVG Monogram**: Changed the favicon from an emoji magnifying glass (🔬) to an SVG data URI with a purple "Rx" monogram on a rounded square (matching `--accent` color). More professional, more deterministic across platforms.

6. **Removed Google Favicons External Dependency**: Changed `renderJobLinkStatus()` in `app.js` from `https://www.google.com/s2/favicons?domain=${domain}&sz=32` to `https://${domain}/favicon.ico`. This removes the dependency on an external Google service and respects the CSP `img-src` policy.

7. **Toast Copy Audit**: Reviewed all 30+ `showToast()` calls. The existing copy is already user-friendly, specific, and actionable. No changes needed.

**Verified:**
- `npm run syntax:frontend` passed
- `npm test` passed (40/40)
- `tokens.css` file verified at `/public/css/tokens.css`
- HTML loads stylesheets in correct order: tokens.css → styles.css → app-surfaces.css

---

## 2026-04-24 (Bug Fixes — Cover Letter Leak & Preview Truncation)

**Scope:** Fix production bugs identified during the Senior Frontend Designer audit: cover letter text bleeding into resume exports, and cover letter preview being truncated in the tab pane.

**Changes across `lib/resume-builder.js`, `tests/core-flow.test.js`, `public/css/styles.css`, `public/js/app.js`:**

1. **Strip Embedded Cover Letter from Resume Text**
   - Added `stripCoverLetter(text)` helper in `resume-builder.js` that detects common cover-letter boundaries (`Dear Name`, `To Whom It May Concern`, `Cover Letter`, `Letter of Application`, `Application Letter`) and truncates everything from the first matched line onward.
   - Integrated the helper into `buildResumeData()` immediately after `sanitizeForATS()` so all export paths (PDF preview, PDF download, DOCX download) exclude cover-letter content.
   - Added test: `strips embedded cover letter from resume text before parsing` in `core-flow.test.js`.

2. **Fix Cover Letter Preview Truncation in Tab Pane**
   - Changed `.cover-letter-container` from `min-height: 100%` to `height: 100%` and added `overflow-y: auto` with `-webkit-overflow-scrolling: touch` in `styles.css`. This ensures the container scrolls when content (plain text or iframe) exceeds the available viewport.
   - Added `iframe.scrolling = 'auto'` in `app.js` when creating the cover-letter preview iframe, ensuring the iframe itself scrolls if internal content overflows.

**Verified:**
- `npm run syntax:frontend` passed
- `npm test` passed (41/41)

## 2026-04-27 (Senior Review Cleanup Before Main Push)

**Scope:** Clean up the unpushed OpenCode patch after senior review, integrate upstream security fixes, and resolve the review regressions before pushing to `main`.

**Changed:**
- **Upstream Security Fixes Preserved**:
  - fast-forwarded local `main` to `origin/main` before continuing the OpenCode work
  - kept the `safeHtml(...)` DOMPurify fallback hardening in `public/js/app.js`
  - kept `escape-html` protection in `lib/template-renderer.js` before `boldMetrics` returns a `SafeString`
- **Pasted JD + URL Flow Fixed**:
  - updated `public/js/app.js` so manual JD submissions still forward any associated job URL
  - this preserves company, portal, and ATS template inference when a user pastes a fallback JD while a job URL probe is pending, aborted, blocked, or failed
- **Company False-Positive Filter Narrowed**:
  - updated `lib/jd-processor.js` so generic fragments like `Our policy` are filtered without rejecting real leading-`The` company names such as `The Trade Desk`
- **Dashboard Scan History Markup Repaired**:
  - replaced the invalid nested `button` inside result-card `a` markup with a non-interactive card wrapper
  - the result title/arrow are separate links and the `Re-scan` control remains a separate button
  - focus styles now use `.scan-history-card:focus-within` so keyboard users see the re-scan shortcut
- **Regression Coverage Added**:
  - added tests for leading-`The` company extraction, generic-fragment suppression, and `careers-` iCIMS customer name extraction

**Verified:**
- `git diff --check`
- `npm run syntax`
- `npm test` (43/43)
- `curl http://localhost:3000/healthz` returned `ok`

---

## 2026-04-27 (UX Fixes — JD Validation, Optimization Safety, Preview Scaling, Scoring Clarity, Accessibility)

**Scope:** Fix five confirmed UX bugs across the scan/results flow covering JD validation, resume optimizer destructiveness, preview clipping, contradictory scoring, and visual hierarchy/accessibility.

### Issue 1 — Pasted JD Validation is Broken (HIGH)

**Root Cause:** `hasManualJobDescription()` accepted any non-empty, non-URL string. `switchJobSourceMode('jd')` immediately called `renderJobLinkStatus` with `state: 'resolved'` before the user typed anything, showing a green "Pasted JD" badge on tab click. Switching back to URL preserved stale JD context.

**Changes across `public/js/app.js`, `public/index.html`, `public/css/styles.css`:**

- Replaced `hasManualJobDescription()` with `validatePastedJd(value)` that returns `{ valid, reason }`. Validates minimum 800 characters, rejects URLs in JD mode, detects gibberish (repeated chars >30%, single word, excessive uppercase), and requires at least 2 of 5 JD signals (role, responsibilities, requirements, skills, company).
- `hasManualJobDescription()` now delegates to `validatePastedJd(value).valid` for backwards compatibility.
- `switchJobSourceMode('jd')` no longer calls `renderJobLinkStatus` with `state: 'resolved'`. Shows idle/neutral state until validation passes.
- `switchJobSourceMode('url')` clears stale JD context (`jdText`, `jdSource`) when no valid JD text exists.
- `setManualJobDescriptionMode()` uses `validatePastedJd()` and shows inline error messages under the textarea via `#jd-paste-error`.
- Form submit handler validates JD mode with `validatePastedJd()` and shows specific inline errors.
- Added `<small id="jd-paste-error">` element in `index.html` and `.jd-paste-error` CSS rule in `styles.css`.

### Issue 2 — Resume Optimization is Too Destructive (MEDIUM)

**Root Cause:** `trimForSinglePage()` aggressively trimmed resumes for candidates with <5 years experience, potentially removing entire job entries. No guardrails existed to prevent excessive experience entry loss.

**Changes across `lib/resume-builder.js`, `lib/agent-pipeline.js`:**

- Changed `isJunior` threshold from `yearsExp < 5` to `yearsExp < 3` so bullet-level trimming is preferred for 3–7 year candidates instead of entry removal.
- Added pre/post experience count check in `buildResumeData()`. If >25% of experience entries are dropped by `trimForSinglePage()`, dropped entries are restored.
- Added consecutive empty paragraph stripping in `createDocxDocument()` to prevent layout gaps.
- Added `preserveAllEntries: true` flag to bullet rewrite API calls and `_instruction` field on keyword plans specifying "rewrite and reorder, do not remove experience entries."

### Issue 3 — Document Preview Scaling is Broken (HIGH)

**Root Cause:** `sizeCoverLetterPreviewFrame()` resolved `availableWidth` to 0 when the container was not visible. The iframe got near-zero width and clipped. CSS `.document-iframe-wrapper` used `overflow: auto` which allowed horizontal overflow.

**Changes across `public/js/app.js`, `public/css/styles.css`:**

- `sizeCoverLetterPreviewFrame()` now falls back to `document.documentElement.clientWidth * 0.8` when container width resolves to < 100px.
- Added `ResizeObserver` in `attachPreviewIframeListeners()` to re-size when container becomes visible.
- Added `requestAnimationFrame` sizing retry after iframe load event and after iframe DOM append in `reloadCoverLetterPreview()`.
- CSS: `.document-iframe-wrapper` changed from `overflow: auto` to `overflow-x: hidden; overflow-y: auto`.
- CSS: `.preview-iframe` gets `max-width: 100%`.
- CSS: `.cover-letter-preview-container` gets `max-width: 100%; overflow: hidden`.

### Issue 4 — Scoring UI is Contradictory (MEDIUM)

**Root Cause:** `updateResultsSummary()` showed "100% match" when `matchRate` was high but `missingKeywords > 0`, contradicting the priority card showing "Close the job-match gap." The visibility card label "Recruiter Visibility" was ambiguous.

**Changes across `public/js/app.js`, `public/index.html`:**

- When `missingKeywords > 0`, the visibility card now shows "X keywords missing" instead of "X% match".
- Visibility body text shows keyword-specific guidance when keywords are missing.
- Card label changed from "Recruiter Visibility" to "ATS Structure" to clarify it measures structure/readability.
- Context strip now shows "X% match · Y keywords missing" when keywords are present, instead of just "X% match".
- Gauge label changed from "JD Match" to "Keyword Match" with a sub-label "semantic score" clarifying it's an AI estimate.

### Issue 5 — UI Hierarchy & Accessibility Issues (MEDIUM)

**Root Cause:** Active tab used full purple gradient (looked like CTA), inactive tab labels had very low contrast (opacity 0.72 on dark background, failing WCAG AA), status pill was a filled green button competing with Download CTA, lock label was all-caps, context cards had minimal padding.

**Changes across `public/css/styles.css`, `public/css/app-surfaces.css`, `public/index.html`:**

- Inactive tab meta opacity raised from 0.72 to 0.85; mobile override color from `0.62` to `0.65`.
- Active tab gradient softened from ~95%/92% opacity to ~22%/18%, with inset bottom border instead of bold CTA gradient.
- `.results-masthead-pill[data-state='ready']` changed to transparent background, border-only style (no filled green).
- `.download-bar-lock-label` removed `text-transform: uppercase`.
- `.results-context-card` padding increased from `var(--sp-3) var(--sp-4)` to `var(--sp-4) var(--sp-5)`.
- `.results-context-label` font-size increased from `0.6875rem` to `0.75rem`.
- "AI Cover Letter" heading changed to "A.I. Cover Letter" to prevent I/l confusion in some fonts.

**Verified:**
- `npm test` passed (43/43)
- `node -e` module load checks passed for `resume-builder.js` and `agent-pipeline.js`
- CSS file integrity verified
