# 0029: The demo restage cron line is edited through the host cron tools

Date: 2026-11-28. Status: accepted. Amends 0021 (the demo restage cron).

## Context

`deploy/demo-restage-cron.sh pasang` and `buang` rewrote the whole crontab with
`crontab -l | grep -vF TAG | crontab -`. That pattern has two known failures:

- When `crontab -l` fails (a busy spool, a permission error, a missing binary), the pipe still feeds `crontab -` an
  empty or partial list, and the host's whole crontab is replaced by it.
- When two writers run at the same time, each one reads, filters and writes back its own copy, so the second write
  drops the line the first one added.

The host has two small tools that edit one tagged line under a shared lock, keep a backup and check the result:
`/home/claude/bin/cron-buang-tag TAG` and `/home/claude/bin/cron-tambah-baris TAG LINE`. Their exit codes are
0 = changed, 3 = nothing to change (quiet), 2 = failed and the crontab was not touched, 64 = wrong use.

## Decision

1. **Both branches call the tools, by full path** (cron runs with `PATH=/usr/bin:/bin`), with the same tag
   `# jamin-demo-restage` and the same line text as before. Nothing else in the script changes: the `run` branch,
   `--kering`, `hos.env`, the Node check and the lock are as they were.
2. **Replace when different.** `pasang` first reads the crontab (read only, `cron_ada`). If the exact line is there it
   prints `already installed` and writes nothing. Otherwise it removes the tagged line with `cron-buang-tag` and adds
   the new one with `cron-tambah-baris`, so a changed interval replaces the old line instead of adding a second one.
3. **Exit codes are not hidden.** 0 and 3 are success. Any other code is printed and returned with `exit "$rc"`; there
   is no `|| true` and no `2>/dev/null` on a tool call, so the tool's own message reaches the log. `buang` returns 0
   when the line was removed or was not there.
4. **Tested on a fake crontab only.** `tests/demo-restage-cron.test.ts` checks the script text (no `| crontab -`, both
   tools by full path, tag and line unchanged, `bash -n`). The behaviour cases run the script with `CRON_FAIL` set to
   a fake crontab file, a fake `HOME` and a `crontab` shim that fails, so the real crontab is never read or written:
   replacing an old `*/5` line keeps the other lines in order, a second `pasang` changes nothing, `buang` twice
   succeeds, and an unreadable crontab fails with exit 2. They are skipped where the host tools are absent (CI).
5. **The two tool paths are the only host paths in the script.** `tests/demo-pool.test.ts` still rejects any other
   `/home/` or `.nvm` path in the script; only these two exact tool paths are allowed.

## Way back

`git revert` the commit that added this record: the old pipe returns. The live cron line is the same text either way,
so no crontab change is needed in either direction.
