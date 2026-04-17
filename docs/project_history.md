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

## Timeline: 2026-04-17 (Current)
**Focus:** CSP Verification Closure, Local Runtime Recovery, Frontend Modularization, and Documentation Hygiene

**Implemented (Added):**
- **Phase 1 CSP Closure**: Removed the remaining inline `onclick` handlers from the live SPA runtime and routed those interactions through centralized `data-*` event delegation inside `public/js/app.js`, keeping the frontend aligned with the strict CSP policy already enforced in `config/security.js`.
- **Native Module Recovery Path**: Re-verified the local SQLite runtime under a newer Node ABI by rebuilding `better-sqlite3`, restoring local server boot and the main smoke/core verification path without needing to wipe `node_modules` or regenerate the lockfile.
- **Verified Local Boot Path**: Confirmed a clean local startup flow using the documented Redis-free fallback path (`UPSTASH_REDIS_URL=`), with healthy `/healthz` and `/readyz` responses while SQLite remained the active local datastore.
- **Phase 2 Frontend Extraction**: Started the native-ES-module "strangler fig" split by pulling shared UI helpers into `public/js/modules/ui-helpers.mjs` and PDF preview behavior into `public/js/modules/pdf-preview.mjs`, while preserving `public/js/app.js` as the stable orchestration layer.
- **Frontend Verification Path**: Re-verified the extracted frontend path with `npm run syntax:frontend`, `npm test`, a clean local boot, and a browser smoke confirming the SPA initialized successfully after loading the new dynamic imports.
- **Docs Maintenance**: Updated `README.md` and `TECHNICAL_DOCUMENTATION.md` with the verified `better-sqlite3` rebuild recovery step, the recommended local boot command when Upstash is intentionally disabled, and the new frontend module ownership boundaries.

**Removed / Fixed:**
- **Blocked Smoke Suite**: Eliminated the `better-sqlite3` ABI mismatch that had been preventing the smoke suite from spawning a local server, returning `npm test` to a fully green state (`21/21` passing).
- **Inline Handler Drift**: Closed the last known gap between runtime behavior and the configured CSP by replacing inline preview retry, copy, and metric-apply interactions with delegated listeners.
- **Frontend Regression Surface**: Reduced the highest-risk share of the SPA monolith by extracting toast/sanitization helpers and PDF preview control logic into isolated modules without forcing a full client rewrite.
- **Undocumented Local Setup Debt**: Removed ambiguity around how to recover from native-module breakage after a Node runtime change by documenting the exact rebuild-first recovery sequence that worked in practice.
