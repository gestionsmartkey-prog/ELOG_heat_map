# Contributing to ELOG heat map

This repo follows the same Git workflow as the SmartKey / PropertyManagement project.

## Git workflow

- **`main` is production.** Vercel deploys production from `main`. Never commit or push to `main` directly.
- **`develop` is the integration branch.** All feature work merges here first via PR. Never commit or push to `develop` directly.
- **Branch off `develop`** for every change. Open a **pull request into `develop`**; merge only after review and green checks.
- **Release** by opening a PR from `develop` into `main`. Merging it deploys to production.

```
main  ────●──────────────────────●───────►  (production; release PRs only)
           \                     /
develop ────●──●──●──●──●──●──●──●──────────►  (integration; feature PRs land here)
                 \        /
feature/…         ●──●──●   (branch off develop, PR back into develop)
```

### Branch names

Use a type prefix and a short kebab description:

- `feature/…` — new capability (e.g. `feature/import-upload`)
- `fix/…` — bug fix (e.g. `fix/geocode-timeout`)
- `chore/…` — tooling, deps, docs, CI (e.g. `chore/branching-workflow`)
- `claude/…` — branches opened by an agent

### Commits & PRs

- Small, atomic commits with clear messages. Verify the build before opening the PR.
- Fill in the PR template. Keep each PR focused on one change.
- A PR must pass the checks in `.github/workflows/pr-checks.yml` (typecheck, lint, unit tests, build) before merge.

## Local checks (run before pushing)

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
```

Browser suites (need a local server) are optional locally and not run in CI:

```bash
npm run test:e2e        # map smoke
node tests/e2e/import.mjs
```

## Database changes

Schema and data changes go in `supabase/migrations/` as a new numbered file, in the PR. The Supabase GitHub integration applies pending migrations when the PR merges; **never apply SQL to the project by hand** (dashboard SQL editor, MCP, `psql`), or the migration history drifts from the repo and has to be reconciled. Never edit an already-applied migration; add a new one. Write migrations so they can run twice (`if not exists`, `create or replace`, `on conflict`). See `README.md` for the ingest and geocoder details.
