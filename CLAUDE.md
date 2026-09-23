# Git workflow (read first)

- `main` is production; `develop` is the integration branch. **Never commit or push to `main` or `develop` directly.**
- Branch off `develop` (`feature/…`, `fix/…`, `chore/…`, or `claude/…`) and open a **pull request into `develop`**.
- Release to production with a PR from `develop` into `main`.
- Database changes are migration files in `supabase/migrations/`, applied by the Supabase GitHub integration on merge. **Never run DDL or data-changing SQL against the Supabase project by hand** (no `apply_migration`, no SQL editor); read-only queries are fine.
- See `CONTRIBUTING.md` for the full workflow and required checks.

@AGENTS.md
