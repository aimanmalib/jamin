# 0025: A "new project" note in the banner and the README

## Context

The event asks projects that did not exist before it started to say so. Jamin's first commit
(4ad48710f055ef59b318338b0020f817be1dc277) was made on 17 November 2026, after the 14 November start; no commit in
the history is older (`git rev-list --before=2026-11-14T14:00Z HEAD` prints nothing).

## Decision

- `config/jamin.json` `banner.note: true` and `banner.firstCommitUrl` (the full commit URL) switch the note on; the
  text is `banner.note` and `banner.firstCommit` in `lang/en.json` and `lang/ms.json`.
- The banner shows the note on its own row, one line at any width: the sentence gives way with an ellipsis, the
  "first commit" link does not, so the Home hero (decision 0024) stays above the fold on an iPhone 13.
- The README repeats the same sentence and link above `## For judges`.

## Consequences

`tests/banner.test.ts` ties the note to config, both language files and the README; `e2e/pages.spec.ts` checks the
link and the single line at 320 px in English and Malay, and `e2e/hero.spec.ts` still holds the fold. Setting
`banner.note` to false removes the note without a code change. The commit link answers 404 while the repository is
private.
