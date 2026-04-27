# ResumeXray Technical Documentation

This document is the engineering reference for the current ResumeXray codebase. It is written against the active SPA-plus-Express architecture in this repository and is intended to explain:

- what the product does end to end
- how requests move through the system
- how frontend, backend, AI, rendering, persistence, billing, and security layers connect
- which files own which concerns
- which top-level functions and routes exist in the first-party codebase
- what operational constraints and current risks matter to maintainers

Scope note:

- This document covers the first-party source of truth in `server.js`, `config/`, `middleware/`, `routes/`, `lib/`, `db/`, `public/`, `tests/`, and the active deployment/configuration files.
- Generated assets in `dist/` are mentioned as deployment artifacts, not as the editable source of truth.
- Minified/vendor code such as `public/js/purify.min.js` is not line-annotated here because it is not authored project logic.

## 1. Product Purpose

ResumeXray is an ATS-oriented resume workflow product. The core promise is:

1. User uploads an existing resume.
2. User supplies either a job description or a job URL.
3. The server resolves job context, including company, job title, job text, and ATS portal when possible.
4. The analysis pipeline parses the resume, evaluates ATS structure and keyword fit, and generates optimization artifacts.
5. The user previews ATS-oriented outputs before paying.
6. Credits are consumed only when exporting the final resume or cover letter.

The product supports two major usage modes:

- `Guest mode`
  Preview-focused, limited daily scans, token-gated access to scan results and previews.
- `Authenticated mode`
  Saved history, dashboard/profile, credit-backed exports, OAuth or email/password access.

## 2. Current Source Of Truth

The repository currently has one active frontend and one active backend. All legacy modular code (`src/`) and build pipelines (Vite) have been removed.

### Active frontend

- `public/index.html`
- `public/js/app.js`
- `public/js/modules/ui-helpers.mjs`
- `public/js/modules/pdf-preview.mjs`
- `public/css/tokens.css`
- `public/css/styles.css`
- `public/css/app-surfaces.css`

### Active backend

- `server.js`
- routes in `routes/`
- business logic in `lib/`
- persistence adapters in `db/`

There is no second active frontend build pipeline anymore.

## 3. Runtime Architecture

```mermaid
flowchart TD
    Browser["Browser SPA (public/index.html + public/js/app.js)"]
    Express["Express App (server.js)"]
    Auth["Auth + Session + CSRF + Passport"]
    Routes["Feature Routes"]
    Agent["Agent Scan Flow"]
    AI["LLM Services"]
    Render["PDF / DOCX Render Pipeline"]
    DB["SQLite or PostgreSQL Adapter"]
    Redis["Redis / Upstash (optional but preferred in prod)"]
    Stripe["Stripe Checkout + Webhooks"]
    Mail["Email Delivery"]

    Browser --> Express
    Express --> Auth
    Express --> Routes
    Routes --> Agent
    Routes --> Stripe
    Routes --> DB
    Agent --> AI
    Agent --> Render
    Agent --> DB
    Auth --> DB
    Auth --> Redis
    Routes --> Redis
    Stripe --> DB
    Mail --> Browser
```

## 4. Boot Sequence

The application boots in this order:

1. `server.js` loads environment variables with `dotenv`.
2. Sentry is initialized early through `lib/error-tracker.js`.
3. Express is created.
4. Trust proxy is enabled.
5. Database adapter is selected and initialized.
6. Graceful-shutdown handlers are registered.
7. Request ID, logging, Server-Timing, and shutdown-guard middleware are mounted.
8. CSP nonce middleware and helmet/security middleware are attached.
9. Compression and body parsers are mounted.
10. Session store is configured using SQLite or PostgreSQL.
11. Passport is configured and session middleware is enabled.
12. Static file serving from `public/` is attached.
13. CSRF token route is mounted.
14. CSRF protection middleware is mounted for state-changing routes.
15. Feature routes are mounted: auth, api, ai, agent, billing, user.
16. Health endpoints and error-report endpoints are mounted.
17. SPA catch-all serves `public/index.html` for app routes.

## 5. End-To-End User Flows

### 5.1 Guest or user opens the app

1. `server.js` serves `public/index.html`.
2. `public/js/app.js` loads the shared frontend modules from `public/js/modules/`.
3. On `DOMContentLoaded`, the SPA waits for those module imports before booting the UI.
4. `fetchUser()` requests `/user/me`.
5. The SPA router initializes and navigates based on current path and auth state.

### 5.2 User authentication

1. Frontend submits login/signup forms to `/auth/*`.
2. `routes/auth.js` validates, rate-limits, updates session, and claims guest scans when relevant.
3. `config/passport.js` handles OAuth strategies and session serialization.
4. Frontend calls `fetchUser()` again and rerenders nav/dashboard/profile state.

### 5.3 User runs a scan

```mermaid
sequenceDiagram
    participant U as User
    participant SPA as public/js/app.js
    participant AG as routes/agent.js
    participant JD as lib/jd-processor.js
    participant SC as lib/scraper.js
    participant DB as db/*
    participant AP as lib/agent-pipeline.js
    participant AI as lib/llm/*

    U->>SPA: Upload resume + enter JD or job URL
    SPA->>AG: POST /api/agent/start
    AG->>JD: processJobDescription()
    JD->>SC: getJobDescription() when URL provided
    JD-->>AG: normalized jobContext
    AG->>DB: create scan session
    AG-->>SPA: sessionId + jobContext
    SPA->>AG: GET /api/agent/stream/:sessionId
    AG->>DB: create placeholder scan
    AG->>AP: runAgentPipeline()
    AP->>AI: scoring / rewrite / cover-letter calls
    AP-->>AG: final scan results
    AG->>DB: persist final scan and optimization artifacts
    AG-->>SPA: SSE init/jobContext/renderProfile/steps/scores/complete
    SPA->>AG: GET /api/scan/:id
    AG->>DB: fetch persisted scan
    AG-->>SPA: normalized scan payload
```

### 5.4 User previews export

1. Frontend switches to Export Preview tab.
2. `reloadPdfPreview()` delegates preview state/control work to `public/js/modules/pdf-preview.mjs` and fetches `/api/agent/preview/:scanId`.
3. `routes/agent.js` calls `renderResumePdf()` in `lib/render-service.js`.
4. `renderResumePdf()` chooses the resume text source, ATS profile, template, and density, then calls `generatePDF()` in `lib/resume-builder.js`.
5. The backend returns a PDF buffer.
6. Frontend converts the PDF response to a blob URL and loads it into the iframe.

Current results-tab contract:

- The canonical tab order is `ATS Diagnosis -> Recruiter View -> Export Preview -> Cover Letter`.
- By explicit product decision, `Export Preview` remains third and `Cover Letter` remains fourth.
- Any future tab reorder must update button order, pane order, `switchTab()` defaults, and `resumeXray_activeTab` persistence together.

### 5.5 User exports

1. Frontend calls `/api/agent/download/:scanId?format=pdf|docx`.
2. `middleware/usage.js` enforces export credit requirements.
3. Backend renders the export and deducts credit atomically.
4. File downloads to the client.

## 6. Directory-Level Structure

### Root

- `server.js`
  Express application bootstrap and runtime wiring.
- `package.json`
  Scripts, dependencies, tooling commands.
- `README.md`
  Operator and developer overview.
- `FRONTEND_ARCHITECTURE.md`
  Frontend source-of-truth guidance.
- `docs/project_history.md`
  Project ledger/history.
- `docs/TECHNICAL_DOCUMENTATION.md`
  This document.
- `railway.json`
  Railway build/deploy entrypoint.
- `ecosystem.config.js`
  PM2 cluster/runtime config.
- `Caddyfile`, `infra/`, `deploy/`
  Infrastructure and deployment assets.

### `config/`

- Authentication, security/CSP/rate limiting, Stripe configuration.

### `middleware/`

- Auth gates, CSRF, uploads, usage/credit limits.

### `routes/`

- HTTP API surface grouped by feature.

### `lib/`

- Business logic and internal services:
  parser, analyzer, sections, xray, keywords, job context processing, LLM prompts/services, rendering, Redis, logging, error tracking, mailer.

### `db/`

- SQLite adapter
- PostgreSQL adapter
- schemas
- migrations
- seeds

### `public/`

- SPA shell, styles, client runtime, metadata/static assets.

### `tests/`

- Smoke tests, core flow tests, PDF/debug/manual test helpers.

## 7. Detailed Server Architecture

## 7.1 `server.js`

Responsibilities:

- environment load
- early Sentry init
- Express app creation
- security and middleware chain
- session store selection
- Passport session support
- static serving
- health and diagnostics endpoints
- route mounting
- SPA shell serving
- graceful shutdown

Important middleware layers in order:

1. request ID assignment
2. request logging
3. Server-Timing
4. shutdown guard
5. CSP nonce creation
6. helmet/security headers
7. permissions and clickjacking protection
8. general rate limiter
9. compression
10. Stripe raw-body webhook route
11. JSON/urlencoded parsers
12. session middleware
13. absolute session timeout middleware
14. Passport initialize/session
15. static serving
16. CSRF token route
17. CSRF protection
18. feature routes
19. health/metrics endpoints
20. CSP/client error sinks
21. SPA catch-all
22. centralized error handler

Primary top-level functions:

- `gracefulShutdown(signal)`
  Drains HTTP traffic, closes browser/Redis/db, and exits cleanly.
- `renderSpaShell(req, res, options)`
  Returns the SPA HTML shell for frontend routes.

## 7.2 Configuration Modules

### `config/passport.js`

Owns Passport strategy wiring and user session serialization.

Key behavior:

- configures Google, GitHub, and LinkedIn OAuth
- serializes only user ID into session
- deserializes users through db adapter
- supports account linking logic

Top-level function:

- `configurePassport()`

### `config/security.js`

Owns:

- helmet CSP
- permissions policy
- clickjacking headers
- Redis-backed or memory-backed rate limiters
- text sanitization helper

Key functions:

- `cspNonceMiddleware(req, res, next)`
- `configureHelmet()`
- `clickjackingProtection(req, res, next)`
- `permissionsPolicyMiddleware(req, res, next)`
- `buildRateLimitStore(prefix)`
- `keyByUserOrIp(req)`
- `makeLimiter(...)`
- `sanitizeInput(text)`

Important exports:

- `generalLimiter`, `authLimiter`, `apiLimiter`, `aiLimiter`, `agentLimiter`, `downloadLimiter`

### `config/stripe.js`

Owns Stripe client initialization and checkout session creation.

Key functions:

- `getStripe()`
- `createCheckoutSession(userId, email, packId)`

## 8. Middleware Layer

### `middleware/auth.js`

Auth and tier gates:

- `isAuthenticated`
- `isPro`
- `isExpert`
- `optionalAuth`

### `middleware/csrf.js`

Synchronizer-token CSRF protection.

Functions:

- `generateCsrfToken(req)`
- `getCsrfToken(req)`
- `csrfProtection(req, res, next)`

### `middleware/upload.js`

Multer configuration and upload-file validation.

Functions:

- `validateMagicBytes(buffer, mimetype)`

Exports:

- `upload`
- `ALLOWED_TYPES`
- `MAX_SIZE`

### `middleware/usage.js`

Usage gates for scans, AI features, and exports.

Functions:

- `checkScanLimit`
- `checkAiCredit`
- `checkExportCredit`
- `checkResumeLimit`

## 9. HTTP Route Surface

## 9.1 `routes/auth.js`

Responsibilities:

- signup
- login
- logout
- OAuth start/callback
- email verification
- resend verification
- forgot/reset password
- account linking
- login lockout state

Supporting functions:

- `checkLockout`
- `checkLockoutState`
- `recordFailedLogin`
- `recordFailedLoginState`
- `clearLoginAttempts`
- `clearLoginAttemptsState`
- `oauthCallbackHandler`

Primary endpoints:

- `POST /auth/signup`
- `POST /auth/login`
- `GET /auth/google`
- `GET /auth/github`
- `GET /auth/linkedin`
- `POST /auth/logout`
- `GET /auth/verify/:token`
- `POST /auth/resend-verification`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `POST /auth/link-account`

## 9.2 `routes/user.js`

Responsibilities:

- current user payload
- dashboard data
- credit history
- password update
- avatar update via a runtime uploads directory, with local-avatar cleanup and staged write/DB failure handling
- account deletion

Functions:

- `detectImageType(buffer)`

Endpoints:

- `GET /user/me`
- `GET /user/dashboard`
- `GET /user/credit-history`
- `PUT /user/password`
- `PUT /user/avatar`
- `DELETE /user/account`

## 9.3 `routes/billing.js`

Responsibilities:

- credit pack catalog
- current credits
- Stripe checkout
- Stripe webhook processing

Endpoints:

- `GET /billing/packs`
- `GET /billing/credits`
- `POST /billing/checkout`
- `POST /billing/webhook`

## 9.4 `routes/api.js`

Legacy/simple API endpoints outside the SSE agent workspace.

Endpoints:

- `POST /api/analyze`
- `GET /api/scan/:id`
- `POST /api/fix-bullet`

## 9.5 `routes/ai.js`

Feature endpoints for AI helpers.

Endpoints:

- `POST /ai/rewrite-bullet`
- `POST /ai/cover-letter`
- `POST /ai/interview-prep`
- `POST /ai/linkedin`

## 9.6 `routes/agent.js`

This is the core product route module.

Responsibilities:

- preflight job context resolution
- scan session creation
- SSE orchestration
- preview generation
- cover-letter preview
- download/export

Supporting functions:

- `parseScanId(raw)`
- `sendEmbeddedState(res, statusCode, payload)`
- `readJobContext(rawJobContext, fallback)`
- `buildSessionJobContext(dbSession)`
- `jobContextNeedsManualPaste(jobContext)`

Endpoints:

- `GET /api/agent/job-context`
  Resolves URL-derived or pasted-JD-derived `jobContext` before starting a scan.
- `POST /api/agent/start`
  Accepts upload + JD/link, creates a scan session, returns `sessionId` and `jobContext`.
- `GET /api/agent/stream/:sessionId`
  Runs the live analysis via SSE and persists placeholder/final scan state.
- `GET /api/agent/preview/:scanId`
  Returns inline preview PDF.
- `GET /api/agent/cover-letter-preview/:scanId`
  Returns preview HTML/PDF-ish cover-letter view.
- `GET /api/agent/download/:scanId`
  Generates downloadable export and charges credit.

## 10. Analysis Pipeline

## 10.1 `lib/agent-pipeline.js`

This is the orchestration engine for a live scan.

Function:

- `runAgentPipeline(resumeText, jdText, emitter, options)`

High-level steps:

1. sanitize resume text for LLM use
2. detect sections
3. run X-ray parser simulation
4. analyze formatting
5. score ATS/readiness
6. extract and match keywords
7. generate recommendations
8. optionally rewrite bullets (stored independently, applied later to structured nodes, never flat text)
9. generate keyword plan
10. generate cover letter when JD exists
11. emit progress/tokens/scores to SSE
12. return final structured result bundle

## 10.2 Parsing, Sections, and Integrity

### `lib/parser.js`

Owns raw document parsing by file type.

Functions:

- `parseResume(buffer, mimetype)`
- `parsePDF(buffer)`
- `parseDOCX(buffer)`
- `parseTXT(buffer)`

Important behavior:

- `parsePDF(...)` now attempts a layout-aware extraction path before falling back to the legacy linear `pdf-parse` text stream.
- The layout-aware path groups page text into rows, splits rows into spans, detects two-column separation heuristically, and serializes content in this order:
  1. header-left
  2. header-right
  3. body left column
  4. body right column
- This materially reduces right-column leakage into left-column experience content on two-column resumes without introducing an external OCR dependency.

### `lib/sections.js`

Owns heuristic structural section detection and integrity checks.

Functions:

- `detectSections(resumeText)`
- `detectContactInfo(text)`
- `analyzeFormat(resumeText)`
- `extractSections(text)`
- `extractContactInfo(text)`
- `validateResumeIntegrity(resumeText, sectionData)`

### `lib/resume-validator.js`

- `validateResumeContent(text)`
  Rejects obviously invalid uploads or non-resume content.

## 10.3 ATS Simulation and Diagnostics

### `lib/xray.js`

Owns parser emulation and extracted fields.

Functions:

- `runXrayAnalysis(rawText)`
- `simulateLegacyParser(text)`
- `simulateStructuredParser(text)`

### `lib/format-doctor.js`

- `checkFormatIssues(rawText, parsedSections)`
  Reports formatting and ATS-readability issues.

### `lib/analyzer.js`

- `analyzeResume(resumeText, jdText = '')`
  Higher-level combined analysis path.

### `lib/scorer.js`

- `generateRecommendations(keywordResults, xrayData, formatIssues)`
  Produces prioritized recommendation text.

## 10.4 Keywords and Matching

### `lib/keywords.js`

Functions:

- `extractKeywords(text)`
- `matchKeywords(resumeKeywords, jdKeywords)`
- `tokenize(text)`
- `findMultiWordSkills(text)`
- `expandTerms(termSet)`
- `fuzzyMatch(term, termSet)`
- `categorize(term)`

These functions support:

- exact keyword extraction
- phrase handling
- fuzzy matching
- categorization for missing/matched keywords

## 10.5 Job Description and ATS Context

### `lib/jd-processor.js`

This module makes job context server-owned and normalized.

Functions:

- `toTitleCase(value)`
- `cleanSlug(value)`
- `serializeTemplateProfile(atsProfile)`
- `hydrateAtsProfile(profileLike)`
- `detectATS(jobUrl, jdText, scrapePlatform)`
- `extractCompanyFromUrl(jobUrl)`
- `extractTitleFromUrl(jobUrl)`
- `extractJobTitleFromText(jdText)`
- `extractCompanyFromText(jdText, jobTitle)`
- `fallbackHostname(jobUrl)`
- `classifyScrapeStatus(errorMessage)`
- `normalizeJobContext(jobContext)`
- `processJobDescription(jdInput, jobTitle, jobUrl)`

`processJobDescription()` is the key entry point. It:

1. accepts pasted JD and/or URL
2. calls `lib/scraper.js` when a URL is present
3. detects ATS platform
4. derives company and title from scraped content, JD text, URL, or hostname fallback
5. normalizes scrape status and template profile
6. returns canonical `jobContext`

### `lib/scraper.js`

Portal-specific job scraping logic.

Functions:

- `getJobDescription(input)`
- `getHeaders()`
- `scrapeWorkday(url)`
- `parseWorkdayResponse(data, jobReqId)`
- `scrapeGreenhouse(url)`
- `scrapeLever(url)`
- `scrapeLinkedIn(url)`
- `scrapeIndeed(url)`
- `scrapeNaukri(url)`
- `scrapeSmartRecruiters(url)`
- `scrapeGenericHTML(url)`
- `extractFromJsonLd(html)`
- `cleanText(text)`

## 11. LLM Layer

The LLM layer is split between prompts and the higher-level service/orchestration.

Important modules in this repo snapshot:

- prompt builders in `lib/llm/prompts/*`
- service wiring in `lib/llm/llm-service.js`

The current code references:

- premium/free model routing
- retries
- queueing
- humanization/de-fluff postprocessing
- streaming support for cover-letter and bullet flows

### `lib/llm/prompts/cover-letter.js`

Primary function:

- `buildCoverLetterPrompt(resumeText, jobDescription, jobContext)`

Purpose:

- forces the cover letter into a concise, professional format
- consumes resolved job context
- bans generic/fluffy opening phrases
- keeps output scoped to facts supported by the resume/JD

## 12. Rendering and Export Pipeline

## 12.1 `lib/render-service.js`

This module is the backend entry point for preview/export resume PDF generation.

Functions:

- `parseMaybeJson(value, fallback)`
- `resolveScanJobContext(scan)`
- `resolveRenderMeta(scan)`
- `getExpectedName(scan)`
- `buildStructuredResumeText(scan)`
- `resolveResumeText(scan)`
- `buildRenderAttempts(jobContext)`
- `renderResumePdf(scan, options)`

Important behavior:

- chooses optimized resume text first
- falls back to structured text rebuilt from extracted sections if needed
- selects ATS-aware template profile and fallback attempts
- validates the produced PDF before declaring it ready

## 12.2 `lib/resume-builder.js`

This module turns resume text into DOCX/PDF outputs.

Functions:

- `standardizeHeader(header)`
- `normalizeDates(text)`
- `sanitizeForATS(text)`
- `stripCoverLetter(text)`
- `splitNonEmptyLines(text)`
- `looksLikeLocationLine(line)`
- `isLikelyContactLine(line)`
- `looksLikeContactBlock(text)`
- `extractHeadlineFromHeaderBlock(text)`
- `isLikelyNameLine(line)`
- `matchSectionHeader(line)`
- `extractHeaderFields(lines)`
- `looksLikeExperienceHeaderLine(line)`
- `buildResumeData(resumeText, sectionData, optimizedBullets, keywordPlan)`
- `polishProfessionalSummary(sections, options)`
- `applyBulletRewrites(sections, optimizedBullets)`
- `trimForSinglePage(sections, { isJunior, maxPages })`
- `createDocxDocument(children, theme)` — now strips consecutive empty Paragraphs from DOCX output
- `stripPlaceholderMetrics(sections)`
- `parseSectionsAdvanced(text)`
- `calculateTenure(experienceLines)`
- `highlightMetricsInSections(sections)`
- `generateDOCX(...)`
- `generatePDF(...)`
- `renderHtmlToPdf(html)`
- `validatePDF(pdfBuffer, expectedNameOrOptions)`

Pipeline summary:

1. sanitize the original resume text for ATS-safe rendering
2. strip any embedded cover-letter content (detects `Dear …`, `To Whom It May Concern`, `Cover Letter`, etc.) so it does not leak into the resume export
3. normalize dates and symbols on that original text
4. parse sections heuristically, including explicit header extraction and exact section-header matching
5. recover cleaner header/contact/summary fields and preserve concise honest source headlines when possible
6. highlight metrics and trim content toward the allowed page budget while the data is still in flat arrays; guard against dropping >25% of experience entries — if threshold exceeded, restore dropped entries preferring bullet-level trimming instead
7. structure flat lines into nested template-friendly objects
8. apply optimized bullet rewrites directly to structured nodes, skipping any rewrite that already failed `contextAudit`; bullet rewrites carry a `preserveAllEntries` directive
9. render the Handlebars HTML template or DOCX section content from those objects
10. use Playwright to generate PDF when PDF output is requested
11. validate text layer and page bounds

Template support:

- the live PDF pipeline now accepts `refined`, `executive`, `corporate`, `modern`, `classic`, and `minimal`
- `refined` is not just a frontend-only preview option; it is wired end-to-end through request normalization, render-service attempt selection, and `generatePDF(...)`
- the live DOCX pipeline now accepts the same template and density inputs as PDF, instead of always emitting one generic Word layout
- DOCX exports remain deliberately ATS-safe:
  - single-column only
  - no tables / text boxes
  - standard section headers
  - deterministic title / company / date ordering
- the current DOCX theme mapping is:
  - `refined` -> professional Word-style theme
  - `executive` -> serif executive Word-style theme
  - `corporate` -> blue-accent corporate Word-style theme
  - `modern` -> blue-accent modern Word-style theme
  - `classic` -> serif black-and-white Word-style theme
  - `minimal` -> compact Word-style theme

Important limitation:

- This pipeline is substantially safer than the older flat-text string-replacement flow, but it is still heuristic.
- False role creation from wrapped comma-heavy bullet lines was materially reduced by the Apr 21 parser/render fix, but unusually malformed resumes can still stress the heuristic boundary.
- Dense tag-style skill sidebars still flatten into plain ATS-safe text rather than a fully semantic skill taxonomy.
- No database migration was required for this refactor; the work was a render-pipeline reordering and structuring change, not a schema rewrite.
- The Apr 23 repair further tightened DOCX reconstruction by:
  - suppressing decorative header noise from summary/contact extraction
  - recognizing aliases like `CORE SKILLS` and `SELECTED IMPACT`
  - preserving location-only lines as location metadata instead of bullet text
  - pairing `degree` + `school | year` education patterns correctly
  - treating sentence-style DOCX paragraphs as implicit bullets when they follow a role header

Historical provenance:

- These render-pipeline decisions were consolidated during the April 2026 remediation cycle after a Codex audit, Gemini planning pass, and Claude Sonnet/Opus implementation refinement.
- The durable engineering outcome is what matters in this reference: keep bullet rewrites off flat text, avoid unnecessary schema migration for this class of fix, and treat malformed-source parsing as an active risk rather than a solved problem.

## 12.3 `lib/template-renderer.js`

This module compiles HTML templates and structures flat lines into template-friendly objects.

**Security Note:** The `boldMetrics` Handlebars helper is security-hardened. It explicitly escapes HTML input using the `escape-html` library before applying regex transformations and returning a `SafeString`. This prevents XSS attacks via resume content in the PDF rendering pipeline.

Functions:

- `loadBaseCss()`
- `getTemplate(name)`
- `detectPlatform(jobUrl)`
- `getPlatformHint(platform)`
- `renderTemplate(templateName, data, options)`
- `buildContactArray(contactString)`
- `isDateOnlyLine(line)`
- `normalizeDateLine(line)`
- `looksLikeStandaloneLocationLine(line)`
- `isLikelyRoleTitle(text)`
- `splitCompanyAndLocation(text)`
- `looksLikeCompanyText(text)`
- `isLikelyEntryHeader(line, nextLine)`
- `looksLikeWrappedBulletContinuation(line)`
- `isLikelyNarrativeBulletLine(line)`
- `shouldStartImplicitBullet(line, previousBullet)`
- `parseEntryHeader(line)`
- `parseInstitutionDateLine(line)`
- `structureExperience(lines)`
- `structureEducation(lines)`
- `structureSkills(lines)`
- `structureProjects(lines)`

Template source files:

- `lib/templates/base.css`
- `lib/templates/refined.html`
- `lib/templates/executive.html`
- `lib/templates/corporate.html`
- `lib/templates/modern.html`
- `lib/templates/classic.html`
- `lib/templates/minimal.html`
- `lib/templates/cover-letter.html`

Important behavior:

- `structureExperience(...)` now strongly prefers real entry headers:
  - header line followed by a standalone date line, or
  - inline role/company patterns with spaced separators like `Title - Company`
- Once the renderer is inside bullets for a role, non-header lines are biased toward bullet continuation instead of being promoted into new fake roles.
- `structureExperience(...)` also supports DOCX-style sentence paragraphs:
  - standalone location lines are attached to the current role
  - sentence paragraphs after a role header become implicit bullets
  - wrapped comma-heavy continuation lines stay inside the current bullet instead of starting fake bullets or fake roles
- `structureEducation(...)` now groups multi-line degree/school text until the date line so wrapped education headers survive export cleanly.
- `structureEducation(...)` also recognizes `School | 2024` style lines and pairs them with the preceding degree line.
- `structureProjects(...)` now keeps trailing sentence descriptions attached to the active project title.
- resume templates now render `strengths` / `selected impact` as a first-class export section instead of dropping that data on the floor.

### 23.15 April 23 DOCX Reconstruction and Export Structure Repair

This pass addressed a specific production-quality failure where a real uploaded DOCX was being converted into a visibly broken export despite the job context being valid.

Changes shipped:

- `lib/resume-builder.js`
  - suppresses decorative header noise so `Master CV`, `Ireland Tech Roles`, and tag-cloud lines do not contaminate summary/contact output
  - favors explicit `PROFILE` / `SUMMARY` sections over header-title fallbacks when both exist
  - recognizes additional section aliases:
    - `CORE SKILLS`
    - `KEY SKILLS`
    - `SELECTED IMPACT`
    - achievement/highlight variants
  - exposes `strengths` / `selected impact` as a rendered export section
- `lib/template-renderer.js`
  - attaches standalone location lines to the current role
  - converts DOCX-style paragraph accomplishments into implicit bullets
  - keeps wrapped continuation lines attached to the active bullet
  - pairs education entries from `degree` + `school | year`
  - attaches narrative project descriptions to the correct project title
- `lib/templates/refined.html`
- `lib/templates/executive.html`
- `lib/templates/corporate.html`
- `lib/templates/modern.html`
- `lib/templates/classic.html`
- `lib/templates/minimal.html`
  - all now render `SELECTED IMPACT` when structured strength/impact lines exist

Validation completed for this pass:

- `node --check lib/resume-builder.js`
- `node --check lib/template-renderer.js`
- `node --test tests/core-flow.test.js`
- local render validation on `/Users/ghasmir/Downloads/ghasmir_ahmad_master_cv_ireland_tech.docx`
  confirmed the repaired export contained:
  - clean summary
  - separate skills section
  - separate selected-impact section
  - correctly structured education and project entries

### 23.16 April 23 Preview Rendering Stability and Paper-Fit Update

This pass addressed the preview-shell behavior for `Export Preview` and `Cover Letter`.

Changes shipped:

- `public/js/modules/pdf-preview.mjs`
  - added preview-variant deduping keyed by:
    - scan id
    - template
    - density
  - single-page PDF previews now fit to available preview height instead of always maximizing width
  - the PDF canvas area now receives an explicit runtime height to stabilize layout
- `public/js/app.js`
  - added shared preview-variant key generation
  - cover-letter preview reloads now short-circuit when the same variant is already mounted
  - cover-letter iframe sizing now uses an A4 aspect-ratio fit calculation instead of raw scroll-height measurement
- `public/css/styles.css`
  - the cover-letter iframe wrapper now centers the page inside a paper-stage background
  - preview iframes now render as bounded paper sheets instead of full-width panes
  - the PDF preview surface background was normalized to the same paper-stage tone
- `lib/templates/cover-letter.html`
  - now wraps preview content in a `letter-sheet` sized to A4 on screen
  - preserves print-safe output with `@media print`

Practical effect:

- revisiting `Export Preview` or `Cover Letter` with the same scan/style no longer forces a redundant rerender
- one-page previews are scaled to feel like an actual sheet
- cover-letter previews no longer rely on an oversized iframe-height hack that could make the page feel clipped or unstable

Validation completed for this pass:

- `node --check public/js/app.js`
- `node --check public/js/modules/pdf-preview.mjs`
- `node --test tests/core-flow.test.js`
- direct render validation confirmed the cover-letter template now emits the A4 `letter-sheet` preview wrapper

### 23.17 April 23 Mobile Responsiveness and Same-Origin Preview Repair

This pass added an explicit mobile audit loop for the public site and repaired the remaining phone-width defects in the results workspace.

#### Mobile Audit Scope

- Verified at `390px` and `320px` widths:
  - `/`
  - `/pricing`
  - `/scan`
  - `/login`
  - `/signup`
  - `/privacy`
  - `/terms`
- Seeded a local guest scan and validated `/results/:id` at `390px` so the densest application layout could be exercised with real tabs, export bars, and document previews.

#### Mobile Navigation Hidden-State Contract

- `public/index.html`
  - the bottom-sheet backdrop now starts with `aria-hidden="true"`
  - the bottom-sheet dialog now starts with:
    - `aria-hidden="true"`
    - `aria-modal="true"`
- `public/js/app.js`
  - `setupMobileMenu()` now:
    - sets `inert` on the sheet while closed
    - removes `inert` on open
    - restores `aria-hidden` on close
- `public/css/styles.css`
  - closed bottom-sheet state now uses:
    - `visibility: hidden`
    - `pointer-events: none`
    - `opacity: 0`
  - open state restores visibility and interaction

Practical effect:
- the hidden menu no longer leaks into the accessibility tree as an active dialog
- offscreen mobile nav no longer bleeds into full-page mobile captures
- closed-state menu controls are no longer accidentally interactive.

#### Mobile Template Picker Behavior

- `public/css/styles.css`
  - phone-width template controls were rebuilt so the export and cover-letter style pills no longer overflow horizontally
  - at `max-width: 600px`, `.pdf-pill-group` now uses a `3 x 2` grid layout
  - all six choices remain visible and tappable:
    - `Refined`
    - `Executive`
    - `Corporate`
    - `Modern`
    - `Classic`
    - `Minimal`

This replaces the previous phone behavior where the pill row overflowed and the rightmost style could become inaccessible.

#### Cover-Letter Preview Loading Fix

- `config/security.js`
  - `clickjackingProtection(...)` now sets `X-Frame-Options: SAMEORIGIN`
  - this matches the existing CSP `frame-ancestors 'self'` policy and still blocks third-party framing while allowing same-origin preview iframes
- `public/js/app.js`
  - historical `/results/:id` views now prefer the document preview path for cover letters instead of forcing the plain-text stream view
  - `reloadCoverLetterPreview(...)` now builds the preview wrapper and iframe via DOM APIs instead of `safeHtml(...)`

Why this was necessary:
- `safeHtml(...)` sanitizes iframe tags away
- the previous combination of:
  - `X-Frame-Options: DENY`
  - sanitized iframe markup
  meant the cover-letter tab could remain stuck in its loading skeleton even when the server returned a valid preview document.

#### Cookie Banner Mobile Tuning

- `public/css/styles.css`
  - reduced mobile cookie-banner padding
  - lowered mobile max-height
  - made the action area sticky within the panel so consent actions remain reachable without the first-visit banner overwhelming the viewport

#### Verification Snapshot

- `node --check public/js/app.js`
- `node --check config/security.js`
- `node --test tests/core-flow.test.js`
- Playwright verification confirmed:
  - no horizontal overflow on audited public routes at `390px` and `320px`
  - seeded results workspace renders correctly at `390px`
  - export preview shows all six style options on mobile
  - cover-letter tab now mounts a live iframe-backed preview
- direct header check:
  - `curl -I /api/agent/cover-letter-preview/:scanId` returns `X-Frame-Options: SAMEORIGIN`

## 12.4 `lib/cover-letter-parser.js`

Transforms raw generated cover-letter text into the structured data required by the cover-letter template.

Functions:

- `formatToday()`
- `splitContact(raw)`
- `stripClosing(body)`
- `stripGreeting(body)`
- `stripSubjectLine(body)`
- `guessHeaderFromText(text)`
- `parseCoverLetter(rawText, ctx)`

Important rendering behavior:

- cover-letter preview HTML now renders inside a dedicated `letter-sheet` wrapper sized like an A4 page on screen
- print/PDF output keeps separate print sizing so the screen-paper wrapper does not distort exported files

## 12.5 `lib/playwright-browser.js`

Shared Chromium lifecycle and render-slot coordination.

Functions:

- `getBrowser()`
- `closeBrowser()`
- `localAcquire()`
- `localRelease()`
- `acquireRenderSlot()`
- `releaseRenderSlot(leaseId)`
- `getRenderStats()`

Purpose:

- reuses a shared Chromium instance
- limits concurrent PDF renders
- uses Redis when available, local semaphore otherwise

## 13. Redis, Logging, Errors, and Email

### `lib/redis.js`

Functions:

- `degradeRedis(reason, err)`
- `getRedis()`
- `closeRedis()`
- `isRedisHealthy()`

Purpose:

- lazily initialize Redis
- use Upstash when configured
- degrade quickly to local behavior on connectivity problems

### `lib/logger.js`

Functions:

- `redactPII(meta)`
- `formatLog(level, message, meta)`
- `log(level, message, meta)`

Purpose:

- structured logging with PII redaction

### `lib/errors.js`

Error hierarchy:

- `AppError`
- `ValidationError`
- `AuthenticationError`
- `ForbiddenError`
- `NotFoundError`
- `ConflictError`
- `RateLimitError`
- `InsufficientCreditsError`
- `ExternalServiceError`
- `ProgrammerError`

### `lib/error-tracker.js`

Functions:

- `initSentryEarly()`
- `initSentry(app)`
- `captureError(error, context)`
- `flushSentry()`

### `lib/mailer.js`

Functions:

- `getEmailDomain(email)`
- `escapeHtml(str)`
- `createEmailTemplate(title, body, actionLabel, actionUrl)`
- `sendVerificationEmail(to, token)`
- `sendPasswordResetEmail(to, token)`
- `sendSSOLoginReminderEmail(to, provider)`

Notes:

- chooses Resend first when `RESEND_API_KEY` is present, SMTP otherwise
- logs the provider message id, active transport, and recipient domain on successful sends
- recipient-domain logging improves deliverability debugging (`gmail.com`, `yahoo.com`, etc.) without logging full email addresses

### `lib/uploads.js`

Functions:

- `getUploadsRoot()`
- `ensureUploadsRoot()`
- `getAvatarUploadsDir()`
- `uploadUrlToPath(uploadUrl)`

Purpose:

- centralize writable upload-path resolution for runtime-generated assets
- keep local development on `public/uploads`
- move production uploads onto a runtime-safe writable directory while preserving public `/uploads/...` URLs

## 14. Database Layer

The repo uses an adapter pattern so SQLite and PostgreSQL expose the same application API.

### 14.1 `db/database.js`

SQLite adapter with migrations and all persistence methods.

Key categories of functions:

- user lifecycle
- verification/reset tokens
- tier/credits/transactions
- resumes and scans
- jobs and cover letters
- guest scan tracking
- scan sessions
- PII encryption helpers
- Stripe webhook idempotency

Important functions include:

- `getDb()`
- `runMigrations(database)`
- `findOrCreateUser(...)`
- `getUserById(id)`
- `getUserByEmail(email)`
- `createUser(...)`
- `verifyUser(userId)`
- `setVerificationToken(...)`
- `setResetToken(...)`
- `updatePassword(...)`
- `claimGuestScans(...)`
- `getCreditBalance(userId)`
- `addCredits(...)`
- `deductCredit(...)`
- `deductCreditAtomic(...)`
- `saveResume(...)`
- `saveScan(...)`
- `updateScan(...)`
- `updateScanWithOptimizations(...)`
- `getUserScans(userId, limit)`
- `getScan(id, userId, accessToken)`
- `getFullScan(scanId, userId, accessToken)`
- `recordGuestScan(ipAddress)`
- `createScanSession(sessionId, data)`
- `getScanSession(sessionId)`
- `deleteScanSession(sessionId)`
- `encryptPii(plaintext)`
- `decryptPii(ciphertext)`
- `isStripeEventProcessed(eventId)`
- `recordStripeEvent(...)`

### 14.2 `db/pg-database.js`

PostgreSQL adapter with interface parity to SQLite.

Additional helpers:

- `withTx(fn)`
- `queryOne(sql, params)`
- `queryAll(sql, params)`

It mirrors the same persistence surface as `db/database.js`.

### 14.3 Schemas and migrations

- `db/schema.sql`
  SQLite schema
- `db/pg-schema.sql`
  PostgreSQL schema
- `db/migrate-pii-encryption.js`
  encryption migration script
- `db/migrate-sqlite-to-pg.js`
  data migration utility
- `db/seed.js`
  local/dev seed data

## 15. Frontend Architecture

The frontend is a single-page application inside `public/index.html`, coordinated by `public/js/app.js`, with an initial native-ES-module extraction in `public/js/modules/` and styling split between the base system in `public/css/styles.css` and the newer premium app-surface layer in `public/css/app-surfaces.css`.

## 15.1 `public/index.html`

Defines:

- global layout shell
- top navigation
- mobile bottom sheet
- landing page sections
- auth views
- scan view
- results workspace
- dashboard/profile/pricing views
- footer
- cookie consent UI

Major view IDs:

- `view-landing`
- `view-signup`
- `view-login`
- `view-forgot-password`
- `view-reset-password`
- `view-verify`
- `view-profile`
- `view-scan`
- `view-results`
- `view-dashboard`
- `view-pricing`
- utility/legal views

Major results panes:

- `tab-diagnosis`
- `tab-recruiter-agent`
- `tab-pdf-preview`
- `tab-cover-letter`

Important results workspace substructures:

- `results-masthead`
  role-first workspace header with readiness and context pills
- `results-context-strip`
  integrated company / portal / source rail rendered inside the masthead copy area
- `results-summary-strip`
  top-priority, recruiter-visibility, and export-readiness cards
- `agent-recruiter-overview`
  recruiter field health counters for captured / partial / missing signals
- `agent-recruiter-rows`
  recruiter-facing field review grid rendered from structured parser output
- `agent-search-visibility`
  matched vs missing keyword signal panel for recruiter/search coverage

## 15.2 `public/js/app.js`

This file is the primary SPA orchestrator and boot/runtime shell. It handles:

- auth bootstrap
- router and page titles
- scan form behavior
- job-context probing
- SSE analysis flow
- results rendering
- dashboard/profile/pricing rendering
- preview/download helpers
- cover letter preview logic
- module bootstrapping for extracted frontend concerns
- cookie consent UI

Major function groups:

### Core utilities

- `clearPdfPreviewObjectUrl(previewFrame)`
- `debounce(fn, ms)`
- `uiIcon(name, options)`
- `announceToScreenReader(message, priority)`
- `fetchCsrfToken()`
- patched `window.fetch`
- `timeAgo(dateStr)`
- `scoreColor(score)`
- `scoreBadge(score, label)`
- `el(id)`
- `$(id)`
- `esc(str)`
- `decodeHtml(str)`
- `safeHtml(html)`
- `truncate(str, len)`
- `formatFileSize(bytes)`

### Extracted runtime modules

- `public/js/modules/ui-helpers.mjs`
  Owns shared DOM helpers, inline SVG icons, ARIA announcements, toast rendering, clipboard copy, escaping, HTML decoding, and DOMPurify-backed sanitization helpers.
- `public/js/modules/pdf-preview.mjs`
  Owns the PDF preview controller, shared preview state, focus-mode toggles, toolbar controls, blob-backed iframe loading, retry UI, and responsive preview sizing.

### Auth and routing

- `fetchUser()`
- `updateNavCredits(balance)`
- `showAuth(mode)`
- `setupRouter()`
- `getPageTitle(path)`
- `getRouteGroup(path)`
- `navigateTo(path, push)`
- `updateActiveNavLink(path)`
- `resetScanForm()`
- `_setupPasswordStrength(inputId, prefix)`
- `setupAuthForms()`
- `verifyEmail(token)`
- `setupGlobalDelegation()`
- `setupPasswordToggles()`
- `setupMobileMenu()`

### Tabs and preview controls

- `switchTab(tabId)`
- `setupPdfPreviewControls()`
- `setPdfPreviewMode(mode)`
- `setPdfPreviewFocusMode(active)`
- `setupResultsTabs()`
- `reloadPdfPreview(scanId)`
- `downloadOptimized(format)`
- `downloadCoverLetter(format)`

### Job context and scan intake

- `extractCompanyFromUrl(urlStr)`
- `capitalize(str)`
- `looksLikeJobUrl(value)`
- `validatePastedJd(value)` — validates pasted JD text (min 800 chars, rejects URLs, detects gibberish, requires 2/5 JD signals); returns `{ valid, reason }`
- `hasManualJobDescription(value)` — delegates to `validatePastedJd(value).valid`
- `getJobContext(scanOrContext)`
- `getJobSourceLabel(jobContext)`
- `getJobStatusTone(jobContext)`
- `renderJobLinkStatus(jobContext, options)`
- `renderScanLoadingContext(jobContext)`
- `updateResultsContextStrip(scanOrContext)`
- `updateResultsWorkflowHints(scanOrContext)`
- `setupCompanyDetection()`
- `setupFileUpload()`
- `setupAgentResults()`
- `startAgentAnalysis(sessionId, initialJobContext)`

### Live results and SSE handling

- `updateAgentProgress(stepNum, status)`
- `addAgentStepCard(step, name, label)`
- `updateAgentStepCard(step, status, label, data)`
- `typewriterToken(step, chunk, bulletIndex)`
- `renderAgentBullet(data)`
- `updateAgentScores(scores)`
- `updateResultsSummary({ scores, scan })` — computes priority/visibility/export cards; visibility card now shows keyword gap when `missingKeywords > 0` instead of raw matchRate; label changed from "Recruiter Visibility" to "ATS Structure"
- `updateResultsWorkspaceHeader({ scan, source })`
- `finalizeAgentUI(data)`

### Historical results and dashboard/profile rendering

- `loadResults(scanId, retryCount)`
- `setupAgentHistoricalView(data)`
- `renderAgentHistoricalTimeline(data)`
- `renderDashboard()`
- `updateDashboardFocus(data, user)`
- `updateDashboardJourney(data, user)`
- `setJourneyItemState(id, state)`
- `getDashboardRecommendation(...)`
- `getDashboardScanTitle(scan)`
- `renderProfile()`
- `updateProfileGuidance(user, creditBalance)`
- `updateProfileMomentum(user, creditBalance)`
- `renderPricing()`

### Recruiter view and bullet fixing

- `normalizeRecruiterFieldValue(value)`
- `formatRecruiterFieldName(fieldName)`
- `getRecruiterFieldEntries(fieldAccuracy, extractedFields)`
- `summarizeRecruiterField(fieldName, rawValue)`
- `buildRecruiterRows(fieldAccuracy, extractedFields)`
- `buildRecruiterOverview(fieldAccuracy, extractedFields)`
- `renderSearchVisibilitySummary(keywordData)`
- `renderRecruiterVisibility(xrayData, keywordData)`
- `fixBullet(btn)`
- `applyFixMetric(fixIndex)`

### Notifications and supporting state

- `showToast(message, type, options)`
- `announceToScreenReader(message, type)` (toast/log variant)
- `addToNotificationLog(message, type)`
- `dismissToast(toast)`
- `copyToClipboard(text, btn)`
- `currentScanTokenQuery()`
- `getActiveScanId()`
- `scanHasTargetJob(scan, jobContext)`
- `persistCurrentScanToken(token)`
- `getPersistedCurrentScanToken()`
- `buildScanApiUrl(scanId)`
- `startCheckout(packId)`
- `animateCountUp(element, target, duration)`
- `renderCoverLetter(text)`

## 15.3 `public/css/styles.css`

This is the active stylesheet for:

- design tokens
- layout system
- landing pages
- auth
- scan
- results
- dashboard/profile
- pricing
- footer
- cookie banner
- responsive behavior

The file is still monolithic, though some app-surface separation work has started elsewhere.

## 15.4 `public/css/app-surfaces.css`

This stylesheet contains newer premium-surface overrides and component-level styling for:

- results masthead and context rail
- recruiter visibility banner, counters, review cards, and keyword signal panel
- profile momentum surfaces
- PDF focus-view overlays and toolbar refinements
- other newer app-surface components that intentionally sit above the older base stylesheet

The active results workspace now depends on both CSS files:

- `styles.css` for tokens, layout primitives, shared component classes, and legacy responsive rules
- `app-surfaces.css` for higher-level visual hierarchy and premium surface presentation

## 16. Frontend/Backend Contracts

Important contracts currently in play:

- `/user/me`
  determines initial auth state
- `/api/csrf-token`
  initializes state-changing request protection
- `/api/agent/job-context`
  powers live URL portal/company/JD detection before scan start
- `/api/agent/start`
  returns `sessionId`, credit balance, and normalized `jobContext`
- `/api/agent/stream/:sessionId`
  emits SSE events:
  - `init`
  - `jobContext`
  - `renderProfile`
  - `step`
  - `token`
  - `bullet`
  - `scores`
  - `coverLetter`
  - `atsProfile`
  - `complete`
  - `error`
- `/api/scan/:id`
  returns persisted scan payload used by results/dashboard/history
- `/api/agent/preview/:scanId`
  returns preview PDF
- `/api/agent/cover-letter-preview/:scanId`
  returns cover-letter preview content
- `/api/agent/download/:scanId`
  returns downloadable export and consumes credits

## 17. Billing and Credits

Credit behavior:

- scans and previews are free
- exports cost credits
- Stripe checkout sells one-time credit packs
- webhook fulfillment updates balances
- atomic deduction logic prevents double charging

Relevant modules:

- `config/stripe.js`
- `routes/billing.js`
- `db/database.js`
- `db/pg-database.js`
- `middleware/usage.js`

## 18. Deployment and Operations

### Railway

- `railway.json`
  starts with `node server.js`
  healthchecks `/healthz`

### VPS / PM2 / Caddy path

- `ecosystem.config.js`
  PM2 cluster configuration
- `Caddyfile`
  reverse proxy/TLS
- `deploy/`
  shell-based provisioning and deploy scripts
- `infra/`
  infrastructure helpers

Important operational nuance:

- the repo supports both a Railway-style direct Node deploy and a PM2/Caddy production topology
- Redis is preferred in clustered deployments for shared rate-limiting and render-slot coordination

Budget-hosting guidance recorded during the April 2026 remediation planning:

- Playwright browser rendering, native modules such as `better-sqlite3`, and local temp-file behavior make serverless/edge-style hosts a poor fit for the full app.
- If the project moves away from Railway, the low-cost path preserved in the remediation planning is an Ubuntu-based VPS flow, with Oracle Cloud A1 identified as the most credible sub-$10/year option.
- The existing Alpine-based Dockerfile should not be treated as the Oracle/Playwright deployment path; the browser dependency story there differs from Railway's Nixpacks-based runtime.

### Local environment recovery notes

- `better-sqlite3` is a native dependency. If the local Node ABI changes, the fastest recovery path is `npm rebuild better-sqlite3`.
- This recovery path was re-verified on 2026-04-17: after rebuilding `better-sqlite3`, the default `npm test` suite returned to green without needing a lockfile reset or full reinstall.
- For clean local boot verification, setting `UPSTASH_REDIS_URL=` forces the app onto the documented in-memory fallback path and avoids requiring a live Upstash connection during startup.
- Phase 2 frontend modularization was also verified on 2026-04-17 with `npm run syntax:frontend`, `npm test`, a clean local boot, and a browser smoke that confirmed the SPA initialized after the new dynamic imports loaded.

## 19. Test Strategy

### Automated tests currently in the main npm test path

- `tests/smoke.test.js`
  server boot, health endpoints, SPA routes, security headers
- `tests/core-flow.test.js`
  ATS detection, structured fallback text, normalized job context, readable PDF preview

### Additional manual/debug scripts

- `tests/test-pdf-live.js`
- `tests/test-pdf.js`
- `tests/test-pdf-debug.js`
- `tests/test-builder.js`
- `tests/test-integrity.js`
- `tests/test-analyzer.js`
- `tests/test-watermark.js`
- `tests/test-bug.js`
- `tests/test-parse-debug.js`
- `tests/test-typst.js`

These are useful for focused debugging but are not all in the default CI test command.

## 20. Current Known Risks and Maintenance Notes

1. `public/js/app.js` is still large even after the initial extraction of shared UI helpers and PDF preview logic into `public/js/modules/*`.
2. `public/css/styles.css` is still monolithic, even though `public/css/app-surfaces.css` now carries part of the newer app-surface layer.
3. Resume PDF quality is improved but still sensitive to malformed or poorly structured source resumes.
4. Cover-letter quality is materially better but still dependent on upstream LLM/provider behavior.
5. Dual deployment stories exist in repo docs and config; maintainers must be clear which target is authoritative in a given environment.
6. Redis is optional in local/dev but strongly preferred in clustered production.
7. When `UPSTASH_REDIS_URL` is configured locally, the Redis-backed rate limiter store can emit transient startup promise rejections before the connection settles; the clean local verification path currently blanks that variable and uses the in-memory fallback instead.

## 21. File Inventory Appendix

This appendix lists the first-party code and config files that matter to maintainers.

### Core runtime

- `server.js`
- `package.json`
- `README.md`
- `FRONTEND_ARCHITECTURE.md`
- `docs/project_history.md`
- `docs/TECHNICAL_DOCUMENTATION.md`

### Config

- `config/passport.js`
- `config/security.js`
- `config/stripe.js`

### Middleware

- `middleware/auth.js`
- `middleware/csrf.js`
- `middleware/upload.js`
- `middleware/usage.js`

### Routes

- `routes/agent.js`
- `routes/ai.js`
- `routes/api.js`
- `routes/auth.js`
- `routes/billing.js`
- `routes/user.js`

### Business logic

- `lib/agent-pipeline.js`
- `lib/analyzer.js`
- `lib/cover-letter-parser.js`
- `lib/error-tracker.js`
- `lib/errors.js`
- `lib/format-doctor.js`
- `lib/jd-processor.js`
- `lib/keywords.js`
- `lib/logger.js`
- `lib/mailer.js`
- `lib/parser.js`
- `lib/playwright-browser.js`
- `lib/redis.js`
- `lib/render-service.js`
- `lib/resume-builder.js`
- `lib/resume-validator.js`
- `lib/scorer.js`
- `lib/scraper.js`
- `lib/sections.js`
- `lib/template-renderer.js`
- `lib/validation.js`
- `lib/xray.js`

### Template assets

- `lib/templates/base.css`
- `lib/templates/modern.html`
- `lib/templates/classic.html`
- `lib/templates/minimal.html`
- `lib/templates/cover-letter.html`

### Database

- `db/database.js`
- `db/pg-database.js`
- `db/schema.sql`
- `db/pg-schema.sql`
- `db/seed.js`
- `db/migrate-pii-encryption.js`
- `db/migrate-sqlite-to-pg.js`

### Frontend

- `public/index.html`
- `public/js/app.js`
- `public/css/styles.css`
- `public/css/app-surfaces.css`
- `public/robots.txt`
- `public/sitemap.xml`
- `public/offline.html`
- `public/llms.txt`

### Tests

- `tests/smoke.test.js`
- `tests/core-flow.test.js`
- `tests/test-analyzer.js`
- `tests/test-bug.js`
- `tests/test-builder.js`
- `tests/test-integrity.js`
- `tests/test-parse-debug.js`
- `tests/test-pdf-debug.js`
- `tests/test-pdf-live.js`
- `tests/test-pdf.js`
- `tests/test-typst.js`
- `tests/test-watermark.js`

### Deployment and infrastructure

- `railway.json`
- `ecosystem.config.js`
- `Caddyfile`
- `deploy/*`
- `infra/*`

## 22. Maintenance Rule

When behavior changes in:

- route contracts
- scan flow
- render pipeline
- auth/session behavior
- billing/credits
- deployment target

then both of these docs should be updated in the same change:

- `docs/project_history.md`
- `docs/TECHNICAL_DOCUMENTATION.md`

## 23. April 19 2026 Remediation Addendum

This section captures the trust-breaking scan/results remediation completed after the multi-model planning pass.

### 23.1 Scan Input Contract

The scan form now treats resume upload and job targeting more strictly:

- Resume uploads are limited to `PDF` and `DOCX`.
- The frontend picker, upload middleware, parser path, and validation copy all reflect the same contract.
- Pasted job descriptions and job-link fetch mode are now mutually exclusive in the UI:
  - pasted JD locks the URL field
  - a successfully resolved job link locks the JD textarea
- Locked inputs receive visible disabled styling so the user understands which targeting mode is currently active.

### 23.2 Resume Validation Hardening

`lib/resume-validator.js` was strengthened to reduce false acceptance of arbitrary documents:

- positive signals now include:
  - email / phone / profile links
  - section headers
  - resume-like date ranges
  - bullet density
  - professional action keywords
- negative signals now subtract confidence for document classes like:
  - invoices
  - contracts
  - proposals
  - privacy / terms documents
- a file must now show both contact evidence and structural resume evidence before it is accepted as a resume

### 23.3 Job Context / Scraper Improvements

`lib/jd-processor.js` and `lib/scraper.js` were expanded so job titles and companies are derived more safely:

- added explicit ATS profiles for:
  - `Indeed`
  - `Cezanne HR`
- title extraction no longer accepts long sentence fragments as role titles
- aggregator / portal hostnames are no longer used as the company fallback when they are obviously not the employer
- scraper output is normalized into:
  - `text`
  - `platform`
  - `metadata.title`
  - `metadata.company`
  - `metadata.location`
- generic HTML scrapes now prepend DOM-derived metadata before downstream job-context parsing

Net effect:

- recruiter/history surfaces are less likely to show:
  - raw domains
  - sentence fragments
  - portal names as employer names

### 23.4 Keyword Extraction Guardrails

`lib/keywords.js` was updated to stop emitting noisy single-letter / ambiguous programming terms:

- raw unconditional `go` and `r` dictionary matches were removed
- contextual detection was added for:
  - `golang`
  - `go language`
  - `go microservices`
  - `R programming`
  - `RStudio`
  - `tidyverse`
- recruiter-view keyword rendering in `public/js/app.js` also filters one-letter / ambiguous tags defensively

This specifically fixes the recruiter-view failure where non-programming JDs were surfacing missing `go` / `r`.

### 23.5 Resume Structuring / Template Safety

The document pipeline was already reordered earlier in the remediation to avoid destructive flat-text replacement. This pass further tightened the remaining heuristic structuring risk:

- `lib/template-renderer.js`
  - rejects lowercase / sentence-like lines as job headers
  - detects wrapped bullet continuations
  - keeps wrapped skill/tool fragments attached to the current bullet instead of splitting them into fake experience entries

This does **not** mean resume generation is perfect; it means one major class of malformed output is now covered by both code and regression tests.

### 23.6 Results / Preview UI

The results workspace was updated in the following ways:

- tab order remains:
  - `ATS Diagnosis`
  - `Recruiter View`
  - `Export Preview`
  - `Cover Letter`
- the tab chrome was visually softened to reduce shell noise
- projected score is now rendered consistently whenever a match score exists
- Export Preview now exposes ATS-safe format switching:
  - `modern`
  - `classic`
  - `minimal`
- selected template state is carried through:
  - inline preview requests
  - full preview URLs
  - download requests
- the PDF preview iframe sandbox restriction was removed from the blob-backed preview path to improve inline rendering reliability

### 23.7 Dashboard Simplification

The dashboard was simplified to reduce confusion:

- removed the extra `journey` / `recent signal` layer
- kept the page focused on:
  - next action
  - latest scan
  - targeted scan count
  - credits
  - recent history
- dashboard/history titles are now sanitized so noisy titles fall back to cleaner role/company labels

### 23.8 Database Reset and Seeding

Both data stores were deliberately reset during this remediation.

#### Local SQLite

- reset via `npm run db:reset`
- local seed data now includes fresh users plus representative resume / scan / job fixtures

#### Supabase / PostgreSQL

- application tables were truncated and identities reset
- a new dedicated seed script was added:
  - `db/seed-pg.js`
- this script recreates:
  - demo users
  - resume data
  - saved jobs
  - scan history
  - cover-letter fixtures

Fresh accounts restored:

- `demo@resumexray.pro / demo1234`
- `pro@resumexray.pro / pro12345`
- `hustler@resumexray.pro / pro12345`

### 23.9 Verification Snapshot

Completed after the remediation and reset:

- `npm run syntax:frontend`
- targeted `node -c` validation on modified backend files
- `npm test` passing at `24/24`
- local browser verification on `http://localhost:3367`

Verified in browser:

- dashboard no longer renders the removed journey grid
- pasted JD mode disables the URL field
- scan-page job-link status reflects pasted-JD mode correctly
- Export Preview format switching activates and changes preview request URLs
- projected score card stays visible once a match score exists

### 23.10 Remaining Caveats

- third-party job sites can still change their markup or anti-bot behavior without notice
- resume generation is materially safer than before but still not yet "premium-perfect" on every malformed source file
- `public/js/app.js` and `public/css/styles.css` remain large and should continue to be modularized after the current trust-critical fixes

### 23.11 April 20 Frontend Refinement Follow-up

This follow-up pass focused on UI polish and cleanup after the larger Apr 19 remediation landed.

Changes shipped:

- refined the results tab bar so it behaves like a cleaner workspace control:
  - grid-based layout
  - calmer shell treatment
  - improved icon/text alignment
  - tighter active-state hierarchy
- preserved the user-approved tab order:
  - `ATS Diagnosis`
  - `Recruiter View`
  - `Export Preview`
  - `Cover Letter`
- shortened tab helper copy to utility labels:
  - `Rules & gaps`
  - `Search fields`
  - `PDF + DOCX`
  - `Targeted draft`
- increased left padding in the job URL input so the inline link icon no longer crowds placeholder text
- removed the stale `updateDashboardJourney(...)` dashboard invocation after the journey panel markup had already been deleted

Verification after this follow-up:

- `npm run syntax:frontend` passed
- `npm test` passed fully (`24/24`)
- local boot remained healthy on the non-Redis fallback path used for verification

### 23.12 April 20 Resume Export Formatting and Page-Budget Update

This pass addressed the actual exported resume quality rather than only the surrounding UI.

Changes shipped:

- tightened the shared PDF template foundation in `lib/templates/base.css`:
  - smaller vertical rhythm
  - better bullet indentation
  - improved title / company / date alignment
  - less wasteful margins and spacing
- added section-specific hooks in:
  - `lib/templates/modern.html`
  - `lib/templates/classic.html`
  - `lib/templates/minimal.html`
  so the render pipeline can selectively tighten or trim low-priority content when the export overflows
- updated `lib/resume-builder.js` so the export budget is now experience-aware:
  - `maxPages = 1` when effective experience is `<= 3 years`
  - `maxPages = 2` when effective experience is `> 3 years`
- changed the PDF fit logic from a blanket one-page target to an allowed-page-budget model
- corrected the fit-height calculation to use printable content height rather than full sheet height
- added a PDF-only compaction pass that progressively:
  - applies compact density classes
  - trims summary length
  - reduces older-role bullet counts
  - removes low-priority sections only if necessary for the current page budget

Missing-skill handling was also improved:

- `keywordPlan` is no longer only diagnostic metadata
- honest `Skills` suggestions are now merged conservatively into the built resume data
- honest `Summary` suggestions can be appended when they are non-duplicative
- suggestions with `honest: false` are explicitly ignored

Verification after this pass:

- `npm test` passed fully (`26/26`)
- regression tests now cover:
  - honest keyword-plan skill injection
  - experienced-resume two-page budgeting
  - one-page PDF validation for an early-career modern-template resume
- artifact validation confirmed a dense early-career sample rendered successfully as:
  - `template: modern`
  - `density: standard`
  - `pageCount: 1`

### 23.13 April 21 Export Quality and Template Policy Update

This pass shifted the export strategy away from early aggressive shrinking and toward preserving quality first, then tightening only when necessary.

Changes shipped:

- added a new ATS-safe template:
  - `lib/templates/refined.html`
- expanded the allowed template set so it now includes:
  - `refined`
  - `modern`
  - `classic`
  - `minimal`
- updated the Export Preview toolbar in `public/index.html` and the selector logic in `public/js/app.js` so users can explicitly choose the new `refined` template
- changed ATS template defaults in `lib/jd-processor.js`:
  - generic default now prefers `refined`
  - several ATS profiles that previously defaulted to `minimal` / `compact` now prefer `refined` or `classic` at `standard` density
- reordered render fallback behavior in `lib/render-service.js` so preview/export attempts now prioritize:
  - the resolved ATS profile
  - standard-density quality fallbacks (`refined`, `classic`)
  - compact fallback only after those higher-quality attempts
  - `minimal` remains the strict fallback, but no longer starts from `compact` by default
- added `polishProfessionalSummary(...)` in `lib/resume-builder.js`
  - normalizes weak first-person / filler-heavy summaries
  - builds a deterministic fallback summary when the parsed summary is weak or missing
  - injects role / years-experience / skill context so the resume header section reads more like a professional finished document

Practical product effect:

- the system now tries to keep the resume readable and professional before shrinking typography
- export previews have a stronger default presentation
- the summary block is less dependent on the quality of the raw uploaded resume text

Validation completed for this pass:

- `node --check public/js/app.js`
- `node --check lib/jd-processor.js`
- `node --check lib/render-service.js`
- `node --check lib/resume-builder.js`
- `npm test -- --runInBand tests/core-flow.test.js`

### 23.14 April 22 Document Quality & Export Integrity Update

This pass implemented the approved document-quality and export-integrity plan across frontend, backend, rendering, billing, and OAuth identity flows.

#### Template Families and Style Contract

- The supported resume families are now:
  - `refined`
  - `executive`
  - `corporate`
  - `modern`
  - `classic`
  - `minimal`
- New assets added:
  - `lib/templates/executive.html`
  - `lib/templates/corporate.html`
- `lib/resume-builder.js`
  - expanded DOCX theme support so Word exports now understand `executive` and `corporate`
  - keeps `refined` as the default family
- `lib/render-service.js`
  - expanded the allowed template set
  - reorders quality-preserving fallback attempts so `refined`, `executive`, `corporate`, and `classic` are tried before compact/minimal fallback

#### Exact-Variant Export Billing

- `routes/agent.js` now builds export idempotency keys from:
  - scan id
  - file format
  - export type
  - template
  - density
  - explicit variant version tag
- Practical behavior:
  - same variant re-download does not burn another credit
  - switching template or file format creates a new billable variant
- The frontend copy in `public/index.html` was updated to make this behavior visible in the export bars.

#### Job Context Recovery and Placeholder Suppression

- `lib/jd-processor.js` now:
  - rejects placeholder job titles such as `Full job description`
  - extracts title candidates from hiring-language intros like `We require an experienced Operations Booking Agent...`
  - extracts company names from employer intros like `Lock Doctor are ...`, `X is ...`, and `At X ...`
  - suppresses aggregator hostnames (`Indeed`, `LinkedIn`, `Glassdoor`, etc.) as fallback company values
  - sanitizes unusable role/company values inside `normalizeJobContext(...)`
- `public/js/app.js` applies matching client-side sanitization so historical scans with noisy stored labels do not leak bad titles/company names back into the UI.

#### Keyword Trust Model

- `lib/keywords.js` was rebuilt around boundary-aware dictionary matching:
  - no more substring hits from `escalated -> scala`
  - no more `rapid -> api`
  - no more `excellent -> excel`
- Requirement-tier parsing now distinguishes:
  - `Responsibilities`
  - `Essential Requirements`
  - `Desirable Requirements`
  - default contextual mentions
- `matchKeywords(...)` only surfaces higher-signal soft-skill gaps and keeps low-signal terms suppressed unless they are explicit requirements.
- `lib/agent-pipeline.js` now generates the keyword plan only from trusted missing keywords rather than merging raw semantic-model missing terms directly into the export mutation path.

#### Trust-First Resume Mutation Rules

- `lib/resume-builder.js` changed in two important ways:
  - `polishProfessionalSummary(...)` no longer uses keyword-plan hints to inject speculative JD-only skills into the summary
  - `applyKeywordPlan(...)` now only adds suggested skills when the resume text itself already evidences that term
- Net effect:
  - exported resumes stop claiming unsupported technologies
  - summary quality improves without drifting away from the candidate's actual source material

#### Cover Letter Generation and Shared Shell

- `lib/llm/prompts/cover-letter.js`
  - now requests 3-4 clean business paragraphs
  - forbids numbered sections, markdown formatting, subject lines, and placeholder role/company usage
- `lib/cover-letter-parser.js`
  - strips numbered/bold legacy output artifacts
  - removes placeholder role/company values before render
- `lib/template-renderer.js`
  - now applies a cover-letter theme based on the selected resume family
- `lib/templates/cover-letter.html`
  - switched from the old hardcoded single look to theme-driven styling tied to the active resume family
- `public/index.html`, `public/js/app.js`, and `public/css/styles.css`
  - rebuilt the Cover Letter tab so it uses the same document workspace language as Export Preview:
    - toolbar
    - template family pills
    - framed preview container
    - bottom export bar

#### LinkedIn OAuth Avatar Handling

- Added `lib/oauth-profiles.js` with `extractLinkedInAvatarUrl(...)`.
- `config/passport.js`
  - now normalizes LinkedIn OIDC avatar payloads across multiple shapes instead of assuming `profile.picture` is always the final string URL
  - logs when LinkedIn returns no usable avatar
- `db/database.js` and `db/pg-database.js`
  - replaced `COALESCE(avatar_url, provider_avatar)` update behavior with `provider_avatar if present else keep current`
  - this ensures OAuth login/linking can refresh the stored avatar when the provider sends a usable profile image

#### Verification for This Pass

- `node --check config/passport.js`
- `node --check lib/jd-processor.js`
- `node --check lib/keywords.js`
- `node --check lib/resume-builder.js`
- `node --check lib/template-renderer.js`
- `node --check public/js/app.js`
- `node --check routes/agent.js`
- `node --test tests/core-flow.test.js`

### 23.18 Phase 1 UI/UX Accessibility and Readability Pass (2026-04-24)

This pass implemented the P1 quick-win changes identified in the Senior Frontend Designer UI/UX review.

**CSS-only changes applied to `public/css/styles.css`:**

1. **Global `prefers-reduced-motion` guard**: A comprehensive `@media (prefers-reduced-motion: reduce)` block was added that forces all animation durations to `0.01ms`, all transition durations to `0.01ms`, and explicitly neutralizes `.animate-fade-up`, `.premium-glow`, `pulse-dot`, `blink`, and `toastSlideIn` keyframes. This replaces the previous narrow rule that only suppressed `.mobile-toggle-inner span` transitions.

2. **Touch-safe hover transforms**: All `transform: translateY(...)` declarations on interactive cards and buttons were removed from their default `:hover` states and consolidated into a single `@media (hover: hover) and (pointer: fine)` media query block. Affected selectors: `.card:hover`, `.card-elevated:hover`, `.step-card:hover`, `.pricing-card:hover`, `.scan-history-card:hover`, `.btn-primary:hover`, `.results-tab-btn:hover`. Touch devices now see border/shadow/color feedback only — no sticky lifted states.

3. **Placeholder contrast raised**: `.form-group input::placeholder` changed from `var(--text-faint)` to `var(--text-secondary)`. `.jd-textarea::placeholder` changed from `var(--text-muted)` to `var(--text-secondary)`. Both now meet WCAG AA contrast against their respective background colors.

4. **Small-text floor raised**: Multiple size values were increased to establish a minimum readable floor of approximately 12px (`0.75rem`):
   - `--text-overline`: `0.6875rem` → `0.75rem`
   - `.hero-proof-kicker`: `0.6875rem` → `0.75rem`
   - `.proof-kicker`: `0.675rem` → `0.75rem`
   - `.proof-label`: `0.84rem` → `0.875rem`
   - `.hero-proof-card span:last-child`: `0.8125rem` → `0.875rem`
   - `.badge`: `0.6875rem` → `0.75rem`
   - `.ring-label` and `.ring-sub`: `0.625rem` → `0.6875rem`
   - `.footer-bottom`: `0.7rem` → `0.8125rem`
   - `.footer-disclaimer`: `0.75rem` → `0.8125rem`
   - `.body-sm`: `0.9375rem` → `0.875rem`

5. **Hero leading opened**: `.hero-title` changed from `clamp(2.5rem, 7vw, var(--text-display))` with `line-height: 1.05` to `clamp(2rem, 6vw, var(--text-display))` with `line-height: 1.12`. Improves readability for stressed users and small viewports.

6. **`.nav-cta:hover !important` removed**: The `!important` declaration on `.nav-cta:hover` background was eliminated by increasing specificity to `a.nav-cta:hover, .nav-cta:hover`.

7. **iOS Safari blur compositing guard**: Added `will-change: transform`, `-webkit-transform: translateZ(0)`, and `transform: translateZ(0)` to `.topbar`. Promotes the sticky navbar to a dedicated compositor layer, preventing the Safari flicker that occurs when the address bar collapses during scroll.

**No JavaScript or HTML changes were made in this pass.**

### 23.19 Phase 2 UX Flow Improvements (2026-04-24)

This pass implemented all 9 Phase 2 UX flow improvements from the Senior Frontend Designer audit. Unlike Phase 1, these changes span HTML, CSS, and JavaScript.

**1. Scan Page: Segmented Toggle for URL vs JD Input** (`index.html`, `styles.css`, `app.js`)

The mutual-locking two-input layout (URL + JD textarea) was replaced with a segmented toggle (`Job URL` / `Paste Description`) that shows one input panel at a time. This eliminates the confusing UX where the URL input would gray out when the user pasted a JD, and vice versa.

- Removed `.job-details-hint` element and its CSS rule; the segmented toggle itself serves as the mode indicator
- Added `.job-source-toggle`, `.job-source-toggle-btn`, `.job-source-panel` CSS classes with active state styling
- Added `setupJobSourceToggle()` and `switchJobSourceMode()` JS functions that manage `activeJobSourceMode` state; switching to JD tab no longer resolves context immediately (shows idle state); switching to URL tab clears stale JD context
- Updated `syncTargetInputState()` to respect the active toggle mode — no field-locking occurs in JD mode
- Manual JD submissions now continue to forward any associated job URL so the backend can still infer company, portal, and ATS template from blocked or still-pending links
- Form validation error messages are now context-aware per active mode ("Add a job link..." vs "Paste the job description...")
- Progressive disclosure (`.scan-col-job-details.is-active`) now includes `.job-source-toggle` and `.job-source-panel`

**2. Results: Session-Based Masthead Compression** (`app-surfaces.css`, `app.js`)

On first visit to a scan result, the full masthead shows. On subsequent visits to the same scan within the same browser session, the masthead compresses to a compact view (no body copy, smaller title, reduced padding).

- Added `viewedResultsSessions` `Set` to track viewed scan IDs
- `updateResultsWorkspaceHeader()` checks the set and toggles `.is-compact` on `.results-masthead`
- CSS `.results-masthead.is-compact` reduces padding, shrinks title, hides `.results-masthead-body`

**3. Results: Priority Card Severity Accent Border** (`styles.css`, `app.js`)

The Top Priority summary card now displays a colored left border based on issue severity.

- Added `data-severity` attribute to `.results-summary-priority` with values: `critical`, `warning`, `good`, or default (accent)
- CSS rules: `--red` border for critical (no target / parse < 70 / format < 70), `--amber` for warning (keyword gaps / low match), `--green` for good (near export-ready)
- `updateResultsSummary()` computes `prioritySeverity` alongside `priorityTitle` and `priorityBody`

**4. Dashboard: Re-Scan Shortcut** (`app.js`, `styles.css`)

Each scan history card now has a "Re-scan" ghost button that navigates to `/scan`. The button is hidden by default and revealed on hover/focus-within, always visible on mobile.

- The card template uses a non-interactive wrapper with separate result links and a separate re-scan button, avoiding invalid nested interactive markup
- CSS: `opacity: 0` by default, `opacity: 1` on `.scan-history-card:hover` / `.scan-history-card:focus-within`, and `opacity: 1` on mobile (≤768px)
- Uses `data-action="navigate" data-path="/scan"` for delegated click routing

**5. Profile: Dynamic Momentum CTA** (`app.js`)

`updateProfileMomentum()` now has four branches instead of three, adding a `scansUsed === 0` state:

1. Unverified email → "Resend Verification Email"
2. Zero scans → "Start Scan" → `/scan`
3. Low credits (< 1) → "Buy Credits" → `/pricing`
4. Default → "Open Dashboard" → `/dashboard`

**6. Colorblind-Safe Status Icons in Recruiter Cards** (`app.js`, `app-surfaces.css`)

Status badges in recruiter signal cards and overview stats now include distinguishable SVG shape icons alongside color:

- Captured (success): checkmark polyline (✓)
- Partial (warning): exclamation-mark circle (⚠)
- Missing (error): X cross (✗)

CSS `.recruiter-status-icon` class provides consistent sizing and per-tone color overrides.

**7. Score Ring `aria-label` and Route Change Announcements** (`app.js`, `index.html`)

- `animateGauge()` now sets `aria-label` (e.g., "Parse Rate: 85%") and `role="img"` on the parent `.score-gauge` SVG
- `navigateTo()` now announces the destination page name via the existing `#sr-announcer` live region (`aria-live="polite"`)

**8. Credit Cost Micro-Interaction** (`index.html`, `styles.css`)

Download PDF and DOCX buttons now wrap their label text in `<span class="download-btn-copy">` and include a `<span class="download-cost-hint">1 credit</span>` badge.

- The cost hint is hidden by default (`opacity: 0`) and revealed on hover/focus
- On mobile (≤768px), the cost hint is always visible
- Provides upfront cost transparency without cluttering the resting UI

**9. Warm Empty States** (`app.js`)

The dashboard "no recent history" empty state was redesigned:

- Replaced the bare search-circle icon with a targeted document+search SVG illustration
- Headline changed to "Your first scan starts here"
- Body copy expanded with clearer value proposition
- CTA button margin increased for better touch target spacing

### 23.20 Phase 3 CSS Architecture & Polish (2026-04-24)

This pass implemented the Phase 3 architecture and polish items from the Senior Frontend Designer audit.

**1. CSS Token Extraction** (`tokens.css` new file, `styles.css`, `index.html`)

Extracted all design tokens from `styles.css` into a new `public/css/tokens.css` file. This file contains:
- All `@font-face` declarations for Inter (400, 600, 700)
- The complete `:root` custom properties block (colors, spacing, typography, motion, radii, shadows, gradients)

`index.html` now loads stylesheets in order: `tokens.css?v=1.0` → `styles.css?v=5.5` → `app-surfaces.css?v=1.2`.

The `styles.css` file header was updated to note that tokens live in `tokens.css` and version bumped to 5.5.0. `FRONTEND_ARCHITECTURE.md` was updated to list `tokens.css` as a source of truth file.

**2. Merged `--bg-deep` / `--bg-base`** (`styles.css`)

Removed the unused `--bg-base: #0e0e14` token. Only `--bg-deep: #0a0a0f` was referenced (4 usages). The values were close enough that merging to a single variable eliminates confusion without any visual change.

**3. Typography Scale Standardization** (`styles.css`)

Added three new design tokens to the `:root` scale:
- `--text-sm: 0.8125rem` (13px, compact labels)
- `--text-xs: 0.6875rem` (11px, micro labels)
- `--text-2xs: 0.625rem` (10px, badge minimums)

These formalize sizes that were already in use as hardcoded `font-size` values throughout the CSS. Progressive migration of hardcoded values to these tokens can happen incrementally.

**4. Unified Accent Family for Credits Badge** (`styles.css`)

Changed `.credits-badge`, `.premium-glow`, `@keyframes pulse-glow`, and `.verify-banner` from the divergent purple `#a855f7` / `rgba(168, 85, 247)` to the app's accent family `#635bff` / `rgba(99, 91, 255)`. Specific changes:
- `.credits-badge` background: `rgba(168, 85, 247, 0.1)` → `var(--accent-subtle)`
- `.credits-badge` border: `rgba(168, 85, 247, 0.2)` → `rgba(99, 91, 255, 0.2)`
- `.credits-badge` color: `#c084fc` → `#a5b4fc`
- `@keyframes pulse-glow`: all `rgba(168, 85, 247, ...)` → `rgba(99, 91, 255, ...)`
- `.credits-badge` hover gradient: `rgba(168, 85, 247, ...)` → accent-family values
- `.verify-banner` gradient and border: `rgba(99, 102, 241, ...)` / `rgba(168, 85, 247, ...)` → `rgba(99, 91, 255, ...)` / `rgba(139, 92, 246, ...)`

**5. Replaced Emoji Favicon with SVG Monogram** (`index.html`)

Changed the favicon from an emoji magnifying glass (🔬) encoded as an SVG data URI to a proper SVG monogram: purple (`#635bff`) rounded square with white "Rx" text. This is deterministic across platforms and aligns with the brand accent color.

**6. Removed Google Favicons External Dependency** (`app.js`)

In `renderJobLinkStatus()`, changed the company favicon source from `https://www.google.com/s2/favicons?domain=${domain}&sz=32` to `https://${domain}/favicon.ico`. This removes the external Google dependency and aligns with the CSP `img-src: https:` directive. The `onerror` handler already hides the favicon image on failure.

**7. Toast Copy Audit** (no changes)

Reviewed all 30+ `showToast()` calls in `app.js`. The existing copy is already user-friendly, specific, and actionable. No modifications needed.

---

### 23.21 Bug Fixes — Cover Letter Leak & Preview Truncation (2026-04-24)

**1. Strip Embedded Cover Letter from Resume Text (`lib/resume-builder.js`)**

- Added `stripCoverLetter(text)` helper that scans line-by-line for common cover-letter start signals:
  - `/^Dear\s+\w/i`
  - `/^To\s+Whom\s+It\s+May\s+Concern/i`
  - `/^Cover\s*Letter\s*$/i`
  - `/^Letter\s+of\s+Application/i`
  - `/^Application\s+Letter/i`
- When a match is found, everything from that line onward is discarded. The remaining text is returned unchanged if no match is found.
- The helper is invoked inside `buildResumeData()` immediately after `sanitizeForATS()`, which means **all** resume export paths (PDF preview, PDF download, DOCX download) are protected.
- Rationale: users sometimes upload a single PDF that contains both a resume and a cover letter. Without stripping, the cover-letter prose leaks into the parsed resume sections (usually the last section or `other`), producing an unexpected "ADDITIONAL INFORMATION" block in exports.

**2. Fix Cover Letter Preview Truncation (`public/css/styles.css`, `public/js/app.js`)**

- `.cover-letter-container` CSS changed:
  - `min-height: 100%` → `height: 100%`
  - added `overflow-y: auto`
  - added `-webkit-overflow-scrolling: touch`
- This ensures the cover-letter tab pane scrolls when its content (plain-text stream or iframe-backed preview) exceeds the available viewport height. Previously the container had no scroll capability and long cover letters were clipped by the parent `overflow: hidden` on `.pdf-preview-container`.
- `reloadCoverLetterPreview()` in `app.js` now sets `iframe.scrolling = 'auto'` on the created preview iframe, guaranteeing that the iframe itself presents scrollbars if the internal A4-sized document grows taller than the iframe bounds.

**Verified:**
- `npm run syntax:frontend` passed
- `npm test` passed (41/41)

### 23.22 Senior Review Cleanup Before Push (2026-04-27)

This pass addressed the senior-review findings against the OpenCode patch before committing and pushing to `main`.

**Security integration**

- Fast-forwarded local `main` to `origin/main` before finalizing the OpenCode changes.
- Preserved the upstream XSS hardening:
  - `public/js/app.js` `safeHtml(...)` strips tags if DOMPurify is unavailable.
  - `lib/template-renderer.js` escapes resume content before applying the `boldMetrics` helper.

**Behavior fixes**

- `public/js/app.js`
  - Manual JD fallback submissions now append the associated job URL whenever one exists, even if the job-context probe is still pending or was aborted by the toggle switch. This preserves iCIMS/company/ATS inference for flows like Screwfix where the user supplies both URL and pasted JD.
  - Dashboard scan-history markup now avoids nesting a re-scan `<button>` inside a result `<a>`. The card is a wrapper with separate result links and a separate re-scan button.
- `lib/jd-processor.js`
  - Narrowed the company false-positive filter so generic fragments like `Our policy` are suppressed without rejecting valid company names such as `The Trade Desk`.

**Regression coverage**

- Added core-flow coverage for:
  - company names with leading `The`
  - generic sentence fragments not becoming companies
  - `careers-` iCIMS hostnames resolving to the customer company name

**Verified**

- `git diff --check`
- `npm run syntax`
- `npm test` (43/43)
- local `/healthz` returned `ok`

### 23.23 UX Fixes — JD Validation, Optimization Safety, Preview Scaling, Scoring Clarity, Accessibility (2026-04-27)

This pass fixes five confirmed UX bugs across the scan/results flow.

**Issue 1 — Pasted JD Validation (`public/js/app.js`, `public/index.html`, `public/css/styles.css`)**

- New `validatePastedJd(value)` replaces the weak `hasManualJobDescription()` check. Validates minimum 800 characters of content, rejects URLs in JD mode, detects gibberish (repeated chars >30%, single word, excessive uppercase), and requires at least 2 of 5 JD signals (role, responsibilities, requirements, skills, company/location/employment type). Returns `{ valid, reason }`.
- `switchJobSourceMode('jd')` no longer resolves context immediately — shows idle state until validation passes. Switching to URL mode clears stale JD context.
- `setManualJobDescriptionMode()` uses `validatePastedJd()` and shows inline errors via new `#jd-paste-error` element.
- Form submit in JD mode validates with `validatePastedJd()` and shows specific error messages.

**Issue 2 — Resume Optimization Destructiveness (`lib/resume-builder.js`, `lib/agent-pipeline.js`)**

- `isJunior` threshold moved from `yearsExp < 5` to `yearsExp < 3`. Bullet-level trimming is preferred for 3–7 year candidates instead of entry removal.
- Post-trim guard in `buildResumeData()`: if >25% of experience entries are dropped, they are restored.
- `createDocxDocument()` now strips consecutive empty Paragraph nodes.
- Bullet rewrite calls include `{ preserveAllEntries: true }`. Keyword plans carry an `_instruction` field: "Rewrite and reorder only; do not remove or skip any experience entries."

**Issue 3 — Document Preview Scaling (`public/js/app.js`, `public/css/styles.css`)**

- `sizeCoverLetterPreviewFrame()` falls back to `document.documentElement.clientWidth * 0.8` when container width resolves to < 100px.
- `attachPreviewIframeListeners()` attaches a `ResizeObserver` on the wrapper for responsive reflow. Sizing is retried via `requestAnimationFrame` on iframe load.
- CSS: `overflow: auto` → `overflow-x: hidden; overflow-y: auto` on `.document-iframe-wrapper`. Added `max-width: 100%` to `.preview-iframe`. Added `max-width: 100%; overflow: hidden` to `.cover-letter-preview-container`.

**Issue 4 — Scoring UI Contradiction (`public/js/app.js`, `public/index.html`)**

- When `missingKeywords > 0`, visibility card shows "X keywords missing" instead of "100% match".
- Visibility card label changed from "Recruiter Visibility" to "ATS Structure".
- Context strip shows "X% match · Y keywords missing" when keywords are missing.
- Gauge label changed from "JD Match" to "Keyword Match" with "semantic score" sub-label.

**Issue 5 — UI Hierarchy & Accessibility (`public/css/styles.css`, `public/css/app-surfaces.css`, `public/index.html`)**

- Inactive tab meta opacity: 0.72 → 0.85. Mobile override: `0.62` → `0.65` color.
- Active tab: gradient softened from ~95%/92% to ~22%/18%; border-based active indicator replaces CTA-style background.
- `.results-masthead-pill[data-state='ready']`: filled green → transparent background, border-only.
- `.download-bar-lock-label`: removed `text-transform: uppercase`.
- `.results-context-card` padding: `sp-3 sp-4` → `sp-4 sp-5`. Label font-size: `0.6875rem` → `0.75rem`.
- "AI Cover Letter" → "A.I. Cover Letter" in pane title.

## 7.3 Payment Gateway Integration: From Stripe to Lemon Squeezy

### Overview

This section details the migration from Stripe to Lemon Squeezy for handling one-time credit pack purchases. The primary goal is to leverage Lemon Squeezy's hosted checkout solution for simplicity and reliability, while maintaining the existing credit-based system for user entitlements.

### Key Changes and Components

#### 1. Multi-Provider Architecture (Strategy Pattern)

The payment system has been refactored to support multiple providers simultaneously. This allows for easy switching between Stripe and Lemon Squeezy via environment variables.

-   **`BILLING_PROVIDER`**: Environment variable to set the active provider (`stripe` or `lemonsqueezy`).
-   **`lib/billing-service.js`**: A new service that acts as a factory and registry for payment providers. It standardizes the interface for creating checkouts and processing webhooks.

#### 2. Backend Integration

##### `lib/billing-service.js` (New Module)

This module implements the Strategy Pattern:
-   **`registerProvider(name, provider)`**: Registers a new payment strategy.
-   **`getProvider(name)`**: Retrieves the active or specified provider.
-   **`createCheckout(userId, email, packId)`**: Standardized method to initiate a purchase.
-   **`verifyWebhook(req)`**: Standardized method to verify webhook signatures.
-   **`processWebhookEvent(event, db)`**: Standardized method to extract transaction data from webhook events.

##### `routes/billing.js`

-   **`POST /billing/checkout`**: Now uses `billingService.createCheckout()` to generate the checkout URL, making it provider-agnostic.
-   **`POST /billing/webhook`**: A unified webhook endpoint that automatically detects the provider (Stripe or Lemon Squeezy) based on request headers and processes the event accordingly.
-   **`POST /billing/lemonsqueezy-webhook`**: Maintained for backward compatibility, internally redirects to the unified `/webhook` handler.

##### `db/database.js`

-   **`addCredits` Function**: The `addCredits` function will be refactored to accept a generic `paymentGatewayTransactionId` instead of `stripeSessionId`. This change will make the function agnostic to the specific payment gateway, allowing it to be reused for Lemon Squeezy and potentially other future integrations.
-   **`credit_transactions` Table**: A database migration will be required to rename the `stripe_session_id` column to `payment_gateway_transaction_id` in the `credit_transactions` table. This ensures consistency and flexibility for different payment gateways.

#### 3. Frontend Integration (`public/js/app.js`)

-   **`startCheckout(packId)` Function**: This function will be updated to make an API call to the modified `/billing/checkout` endpoint. Upon receiving the Lemon Squeezy hosted checkout URL, the frontend will redirect the user to this URL to complete the purchase.
-   **UI Updates**: Existing UI elements that might display Stripe-specific branding or information will be reviewed and updated to reflect the transition to Lemon Squeezy, although the current credit-focused UI is largely payment-gateway agnostic.

### Data Flow for Lemon Squeezy Checkout

```mermaid
sequenceDiagram
    participant User
    participant Frontend as public/js/app.js
    participant Backend as routes/billing.js
    participant LS as Lemon Squeezy Hosted Checkout
    participant LS_Webhook as Lemon Squeezy Webhook Service
    participant DB as db/database.js

    User->>Frontend: Clicks 
on "Buy Now" for a credit pack
    Frontend->>Backend: POST /billing/checkout { packId, userId, email }
    Backend->>Backend: Calls createCheckoutUrl(packId, userId, email)
    Backend->>LS: Requests hosted checkout URL
    LS-->>Backend: Returns hosted checkout URL
    Backend-->>Frontend: { url: LemonSqueezyCheckoutUrl }
    Frontend->>User: Redirects to LemonSqueezyCheckoutUrl
    User->>LS: Completes payment on hosted checkout page
    LS->>LS_Webhook: Sends order_created webhook event
    LS_Webhook->>Backend: POST /billing/lemonsqueezy-webhook { event_payload }
    Backend->>Backend: Verifies webhook signature
    Backend->>DB: addCredits(userId, amount, 'purchase', order_id, description)
    DB-->>Backend: Credits added successfully
    Backend-->>LS_Webhook: 200 OK
    LS-->>User: Redirects to success_url (e.g., /dashboard?purchased=true)
    User->>Frontend: Lands on success page, UI updates credit balance

### Implementation Details

#### `config/lemonsqueezy.js`

This new module centralizes Lemon Squeezy configuration. It defines `CREDIT_PACKS` mapping internal pack IDs to Lemon Squeezy variant IDs and provides `createCheckoutUrl` for generating hosted checkout URLs and `verifyWebhookSignature` for validating incoming webhooks.

#### `routes/billing.js`

-   The `POST /billing/checkout` route has been updated to use `createCheckoutUrl` from `config/lemonsqueezy.js` to generate the checkout URL and redirect the user.
-   A new route, `POST /billing/lemonsqueezy-webhook`, has been added to handle Lemon Squeezy `order_created` webhook events. This route verifies the webhook signature, parses the event payload, and calls `db.addCredits` with the Lemon Squeezy order ID for idempotency.

#### `db/database.js`

-   The `addCredits` function has been made more generic to accept a `paymentGatewayTransactionId` instead of `stripeSessionId`.
-   New functions `isLemonSqueezyEventProcessed` and `recordLemonSqueezyEvent` have been added to handle idempotency for Lemon Squeezy webhooks, similar to the existing Stripe event handling.
-   A migration has been added to `runMigrations` to create the `lemon_squeezy_events` table in the database schema.

#### `db/schema.sql`

-   The `lemon_squeezy_events` table has been added to the schema to store Lemon Squeezy webhook event IDs for idempotency checking.
