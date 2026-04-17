# Frontend Architecture

ResumeXray uses a single frontend: the server-rendered SPA shell in `public/`.

## Source Of Truth

- `public/index.html`
- `public/js/app.js`
- `public/css/styles.css`

`server.js` serves these files directly. There is no separate client build pipeline required for the active app.

## Development Workflow

- Run `npm run dev` to start the Express server in watch mode
- Edit files in `public/` for frontend changes
- Run `npm run syntax` to verify both frontend and backend JavaScript syntax

## Guardrail

Do not introduce a second active frontend implementation alongside the SPA.

If a future migration is needed, it should happen in a dedicated branch with:

- a documented route and DOM contract
- a green validation path before rollout
- an explicit cutover plan
