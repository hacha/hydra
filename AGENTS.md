# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains all runtime code: `lib/` for Hydra bridges (MIDI hooks, PatchBay, p5 wrapper), `stores/` for application state, and `views/` for Choo components. Keep new modules inside these buckets rather than creating parallel roots.
- `public/` hosts static assets served verbatim, while `docs/` stores long-form documentation and reference screenshots; keep generated media out of `src/`.
- `dist/` is Vite’s build artifact and must remain untracked. Docker- and Nginx-related manifests (`Dockerfile*`, `docker-compose.yml`, `nginx.conf`) live at the root; update them whenever runtime behavior changes.

## Build, Test, and Development Commands
- `npm install` — sync dependencies after pulling. Use Node 18 LTS to match CI.
- `npm run dev` — launches Vite on `http://localhost:5173` with hot reload; verify MIDI, keybinds, and canvas sizing here.
- `npm run build` — produces a production bundle under `dist/`; run before any PR to ensure tree-shaking-safe imports.
- `npm run publish` — pushes the current `dist/` to GitHub Pages (`gh-pages` branch). Only run from a clean main.
- `docker compose up --build` — optional container workflow that mirrors production Nginx; useful for regression reviews.

## Coding Style & Naming Conventions
- Use modern ES modules, 2-space indentation, and prefer trailing commas for multi-line literals. Match the prevailing “no unnecessary semicolons” style (only add where ASI fails).
- Name files and directories in kebab-case (`p5-wrapper.js`, `patch-bay/`); export classes in PascalCase and helpers in camelCase.
- Keep UI text and keybind strings in `src/lib/config.js` or localized helpers; avoid hardcoding inside views where reuse is likely.

## Testing Guidelines
- There is no automated suite; treat `npm run build` as a smoke test and capture console output. Document any manual steps in `docs/` (e.g., recording new keybinding screenshots).
- For behavioral additions, supply reproducible steps in the PR and include sample Hydra patches under `docs/` if they help reviewers.
- When touching rendering code, validate both the default resolution and any overrides from `config.resolution` or Docker env variables.

## Commit & Pull Request Guidelines
- Follow the existing Conventional Commit flavor (`feat: …`, `fix: …`, `chore: …`). Short (<60 char) summaries, optional Japanese body text is fine.
- Each PR should describe motivation, testing performed, and any UI-impacting screenshots or GIFs. Link related issues or upstream Hydra tickets when applicable.
- Update `README.md` or `docs/` whenever user-facing behavior, keybinds, or deployment steps change; note breaking changes prominently in the PR description.

## Security & Configuration Tips
- Never commit `.env*` files or credentials; rely on Docker compose overrides or runtime env vars for server URLs and resolutions.
- Ensure any new network surfaces pass through the existing PatchBay abstraction; avoid ad-hoc WebRTC or WebSocket initializers in views.
- Scrub console logs before merging, keeping only actionable messages gated behind `if (import.meta.env.DEV) { … }` to avoid leaking internal endpoints.
