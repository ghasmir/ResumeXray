# ResumeXray Frontend Audit

> Historical note: this audit captures the repo state before the frontend ownership decision was finalized. The inactive modular `src/` frontend and Vite pipeline were later removed after choosing the server-served SPA in `public/` as the single frontend source of truth.

Date: 2026-04-15

## Summary

This audit reviews the full frontend with a product-design lens: UX, visual design, interaction quality, conversion clarity, accessibility, responsiveness, and frontend maintainability.

What I reviewed:

- Rendered local public pages on desktop and mobile: landing, scan, pricing
- Rendered authenticated pages with a seeded local account: dashboard, profile
- Static/code review of auth, results, loading, empty, and error states
- Frontend architecture review across the live legacy SPA and the inactive modular `src/` app

Important context:

- The live product is still the legacy SPA in `public/index.html` + `public/js/app.js`
- The modular frontend in `src/` is not the active app and currently does not build cleanly
- Results views were reviewed from code/static structure rather than a live seeded scan result

## Strengths Worth Preserving

- The core product idea is legible. “Upload -> diagnose -> recruiter view -> cover letter -> export” is a strong mental model.
- The public funnel has a coherent premium-dark visual direction with good token discipline and consistent spacing.
- The scan page reduces friction well with file-type trust cues, a single primary CTA, and clear upload affordances.
- The results architecture is ambitious in the right way: diagnosis, recruiter visibility, cover letter, and PDF preview are the right buckets.
- There is real accessibility intent in the codebase: skip link, `:focus-visible`, reduced-motion handling, focus management, and keyboard-aware tab behavior.

## Critical Findings

### 1. Split frontend ownership is already breaking product reliability

What the user experiences:

- Design and behavior fixes are not dependable because the repo contains two competing frontends that no longer agree on structure or behavior.
- The inactive modular app cannot be activated safely today.

Why it matters:

- This is the highest-leverage problem in the frontend. Until one frontend becomes the clear source of truth, UX improvements will keep getting lost, duplicated, or re-broken.

Evidence:

- The live HTML explicitly loads the legacy app, and the comment says the `src/` modules are “for future migration only”: `public/index.html:2798-2800`
- `npm run build` currently fails on the modular app with an unresolved import from `src/features/scan/index.mjs`
- Feature modules in `src/` point at selectors and structures that do not match the live DOM:
  - `src/features/scan/index.mjs:6-8`, `104-105`, `147`
  - `src/features/auth/index.mjs:170-181`
  - `src/features/dashboard/index.mjs:27-35`, `217-240`
  - `src/features/profile/index.mjs:24-55`, `108-140`
- The live DOM uses different IDs/classes:
  - `public/index.html:708-722`, `818-833`
  - `public/index.html:1400-1466`
  - `public/index.html:2264-2362`

Recommended fix direction:

- Choose one active frontend as the source of truth before doing deeper redesign work
- Make that frontend build green in CI
- Create a route/selector contract for auth, scan, dashboard, profile, and results
- Either finish the migration or freeze/remove the inactive branch until it can be completed safely

## High Findings

### 2. SPA routes do not update the page title

What the user experiences:

- After moving through the app, the browser tab still reads like the landing page.

Why it matters:

- This hurts orientation, bookmarking, browser history, screen-reader context, and perceived polish.

Evidence:

- The document has a single landing-page title in `public/index.html:32`
- The live SPA router changes views but never updates `document.title`: `public/js/app.js:294-380`
- Local verification showed `/dashboard` still reporting the landing-page title after login

Recommended fix direction:

- Add a route metadata map in the live router and update `document.title` on every navigation

### 3. Scan history cards are not keyboard-activatable

What the user experiences:

- Returning users who navigate by keyboard can focus a history card, but cannot reliably open it.

Why it matters:

- This is a real accessibility failure in a core returning-user workflow.

Evidence:

- Scan history cards are rendered as clickable `div`s with `role="button"` and `tabindex="0"`: `public/js/app.js:2821-2845`
- Global interaction handling is click-only for navigation actions: `public/js/app.js:653-679`

Recommended fix direction:

- Render history items as real links or buttons
- If that is not possible immediately, add Enter/Space key handlers that mirror click behavior

### 4. Mobile PDF preview is still a desktop document inside a phone shell

What the user experiences:

- On small screens, the PDF tab relies on horizontal scrolling and a “scroll to view full document” hint instead of feeling native.

Why it matters:

- This is one of the four primary value surfaces in the product. If it feels awkward on mobile, the “download-ready” moment feels lower quality.

Evidence:

- The mobile PDF frame is hard-coded to A4 desktop dimensions: `public/css/styles.css:4236-4241`
- The UI adds a mobile hint overlay rather than a fit-to-width preview: `public/css/styles.css:4248-4255`

Recommended fix direction:

- Default to a fit-to-width preview on mobile
- Add zoom/fullscreen controls for detailed inspection
- Consider an image/raster preview for mobile, with the full PDF available on demand

### 5. Pricing clarity and brand tone are working against trust

What the user experiences:

- The pricing page opens with aggressive language and tier naming that feels less credible than the seriousness of the job-search context.
- The actual “credits only for exports” model is explained below the plan cards instead of where the purchase decision is made.

Why it matters:

- Job seekers are making high-emotion decisions here. Trust beats swagger.

Evidence:

- Pricing headline/tier language: `public/index.html:2076-2142`
- The credits explanation is pushed into a secondary section after the pricing table: `public/index.html:2146-2215`

Recommended fix direction:

- Rewrite the headline and tier labels in a more professional, outcome-oriented tone
- Surface the export/credit model directly inside the pricing cards and CTA area
- Reduce discount-sticker energy and emphasize clarity, reassurance, and what is actually free

## Medium Findings

### 6. Important explanatory text is consistently too small and too faint

What the user experiences:

- A lot of instructional and trust-building copy reads like metadata instead of usable content.

Why it matters:

- This reduces readability, especially on mobile, on lower-brightness displays, and for users scanning quickly under stress.

Evidence:

- Global small-text styles: `public/css/styles.css:314-323`
- Landing proof labels are especially tiny: `public/css/styles.css:1015-1021`
- Footer text is pushed down to 10-11px territory: `public/css/styles.css:2885-2912`
- Dashboard support copy is also very small: `public/css/styles.css:6068-6072`

Recommended fix direction:

- Raise the floor for support text to roughly 13-14px
- Increase contrast on instructional text
- Reserve ultra-small text for truly optional metadata only

### 7. The scan form’s progressive disclosure is conceptually good but visually confusing

What the user experiences:

- Before a file is uploaded, the target-job section is visible but looks half-broken or disabled without enough explanation.

Why it matters:

- First-time users can mistake staged disclosure for a broken form.

Evidence:

- The live JS only activates the job details after file upload: `public/js/app.js:1008-1018`
- The CSS leaves the panel visible but inert through opacity/pointer-events: `public/css/styles.css:6630-6644`

Recommended fix direction:

- Replace the inert form with a clear “Step 2 unlocks after upload” placeholder
- Or hide the entire pane until a file is selected

### 8. Authenticated pages underdeliver on momentum compared with the landing experience

What the user experiences:

- The signed-in product feels visually flatter and more generic than the public promise.
- Dashboard and profile are readable, but they do not feel especially premium, guided, or progress-oriented.

Why it matters:

- This is where trust should convert into sustained usage. Right now the product feels strongest before login, not after it.

Evidence:

- Dashboard layout is mostly passive stats plus a history block: `public/index.html:2264-2362`
- Profile is a stack of utility cards without much hierarchy beyond account administration: `public/index.html:983-1300`
- Rendered local dashboard/profile confirm a sparse, low-momentum post-login experience

Recommended fix direction:

- Give each signed-in page a stronger primary job-to-be-done
- Elevate progress, recent wins, and next recommended actions above passive account metadata
- Reduce dead space and compress secondary chrome

### 9. The footer is too dominant on utility surfaces

What the user experiences:

- On dashboard, profile, and auth pages, a large marketing/footer block competes with the page’s core task.

Why it matters:

- Utility views should feel focused and lightweight. The current footer makes them feel more like brochure pages.

Evidence:

- The footer has large top margin and padding: `public/css/styles.css:2856-2860`
- On rendered dashboard/profile/auth screens, the footer consumes a disproportionate amount of the page relative to the main task

Recommended fix direction:

- Use a compact app footer for signed-in pages
- Keep the large marketing/legal footer only on public funnel pages

### 10. The visual tone mixes premium-product cues with casual UI moments

What the user experiences:

- The product alternates between polished enterprise-like glassmorphism and casual emoji-driven UI moments.

Why it matters:

- Mixed tone makes the interface feel less intentional and lowers perceived craft.

Evidence:

- Emoji-driven feature/step language in the marketing UI: `public/index.html:552-585`
- Password toggle buttons switch from SVG icons to emoji in the live JS: `public/js/app.js:1961-1978`

Recommended fix direction:

- Pick a single tone system and apply it consistently
- If the product should feel premium and credible, remove incidental emoji and informal visual metaphors from utility flows

## Low Findings

### 11. Social proof is visually emphasized but semantically under-supported

What the user experiences:

- The landing page pushes specific usage/performance claims very hard without enough visible qualification.

Why it matters:

- In a trust-sensitive product, unsupported specificity can read as marketing inflation.

Evidence:

- Social proof numbers and callback claims are prominent in the hero band: `public/index.html:541-559`
- Their labels are visually tiny: `public/css/styles.css:1015-1021`

Recommended fix direction:

- Either substantiate the claims visibly or soften the specificity
- Improve legibility if these numbers remain central to the pitch

### 12. Results information architecture is promising but chrome-heavy

What the user experiences:

- The results model is strong, but the amount of framing copy, tab chrome, and download UI risks competing with the actual insight.

Why it matters:

- The core diagnosis should feel immediate and decisive.

Evidence:

- The results surface has a strong four-tab structure, but each pane leads with a substantial amount of framing UI: `public/index.html:1548-2070`

Recommended fix direction:

- Keep the tab model
- Compress repeat explanatory text after first use
- Promote the single most actionable insight in each tab before secondary controls

## Highest-Leverage Next Moves

### Quick wins

- Add route-based page titles to the live SPA
- Increase minimum support text size and contrast across landing, pricing, dashboard, profile, and footer
- Fix scan history cards to use real keyboard-accessible controls
- Rewrite pricing headline/tier language and move “credits only for exports” into the plan decision area

### Structural cleanup

- Pick one frontend as the source of truth and make it build green
- Create a DOM/route contract checklist before continuing the migration
- Split the current monolithic stylesheet by surface or component layer once ownership is clarified

### Deeper redesign opportunities

- Redesign the signed-in experience so it feels as confident and premium as the public funnel
- Rework scan-to-results flow so staged disclosure feels intentional, not disabled
- Make the mobile results preview feel native rather than desktop-scaled
