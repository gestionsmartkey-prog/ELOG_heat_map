# Git workflow (read first)

- `main` is production; `develop` is the integration branch. **Never commit or push to `main` or `develop` directly.**
- Branch off `develop` (`feature/…`, `fix/…`, `chore/…`, or `claude/…`) and open a **pull request into `develop`**.
- Release to production with a PR from `develop` into `main`.
- See `CONTRIBUTING.md` for the full workflow and required checks.

@AGENTS.md
