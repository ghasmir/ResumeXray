# Frontend Architecture

ResumeXray uses a single frontend: the server-rendered SPA shell in `public/`.

## Source Of Truth

- `public/index.html`
- `public/js/app.js`
- `public/css/tokens.css` — Design tokens and @font-face (MUST load first)
- `public/css/styles.css` — Layer 1 base definitions + Layer 2 premium overrides
- `public/css/app-surfaces.css` — View-level surface styles (results, recruiter, dashboard, profile)

`server.js` serves these files directly. There is no separate client build pipeline required for the active app.

## Development Workflow

- Run `npm run dev` to start the Express server in watch mode
- Edit files in `public/` for frontend changes
- Run `npm run syntax` to verify both frontend and backend JavaScript syntax

## CSS Architecture

### Three-file load order

CSS files MUST load in this order — earlier files own primitives that later files compose against:

1. **`public/css/tokens.css`** — Custom-property design tokens (palette, spacing, typography scale, motion, radii, shadows) and `@font-face` declarations for the self-hosted Inter subset. This file MUST load before all others.
2. **`public/css/styles.css`** — Two-layer CSS:
   - Layer 1 (~lines 1–2200) — base definitions: layout, typography, components.
   - Layer 2 (~lines 3100+) — premium visual overrides: shadows, gradients, hover states.
3. **`public/css/app-surfaces.css`** — view-level surface styles for results, recruiter review, dashboard journey cards, profile momentum banner, and PDF viewer overlays.

### Resume-export CSS (`lib/templates/base.css`)

This is a separate CSS file used **only** for generated resume PDFs/DOCX (loaded by Playwright when rendering Handlebars templates). It is intentionally minimal and ATS-safe:

- single-column layout only
- semantic HTML (h2, ul, li, p)
- standard fonts (Arial, Calibri, Georgia, Helvetica, Times New Roman)
- no decorative Unicode beyond `•`
- selectable text only — never canvas / rasterized

### Density ladder for PDF page-budget enforcement (May 2026)

`base.css` defines a **four-tier density ladder** that `lib/resume-builder.js#renderHtmlToPdf` applies in order until generated content fits the target page budget. Content is never deleted — only typography and spacing tighten:

| Tier | Body size | Line height | Trigger |
|---|---|---|---|
| `density-compact` | 9.25pt | 1.16 | Standard compact |
| `pdf-tight` | 8.75pt | 1.10 | Above-target overflow |
| `pdf-ultra-tight` | 8.25pt | 1.04 | Significant overflow |
| `pdf-veteran-tight` | 7.8pt | 1.02 | Extreme overflow (10+ year veterans) |

After the ladder, a clamped print-scale floor is applied:

- 1-page exports: `0.80` minimum
- 2-page exports: `0.82` minimum (lowered from `0.86` so 10-year veteran resumes complete cleanly)

`pdf-veteran-tight` is the lowest readable floor — anything below 7.5pt risks ATS parser failures on Workday and Taleo. This is documented inline in `lib/templates/base.css` and `lib/resume-builder.js#renderHtmlToPdf`.

## Guardrail

Do not introduce a second active frontend implementation alongside the SPA.

If a future migration is needed, it should happen in a dedicated branch with:

- a documented route and DOM contract
- a green validation path before rollout
- an explicit cutover plan
