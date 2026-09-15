@AGENTS.md

## Claude Code specifics

- Use plan mode for anything beyond a trivial, single-file change — outline
  the approach before writing code, per `AGENTS.md`'s architecture section.
- Before opening a PR or asking for a merge, run the golden safety net
  yourself (`npm test`) — don't rely on CI to be the first place a moved
  score is noticed.
- Module-specific rules that only apply under one directory live in
  `.claude/rules/` (`paths:`-scoped) rather than here, so they load only
  when relevant: `.claude/rules/engine.md`, `providers.md`, `criteria.md`.
- No `Co-Authored-By` trailer in commit messages (repeated from
  `AGENTS.md` since this is a common default to override).
