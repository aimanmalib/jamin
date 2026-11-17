# Notes for coding agents

- Node 22, TypeScript strict, npm with exact versions (`.npmrc` sets `save-exact`). ES modules.
- Contracts live in `contracts/` and are tested with SolidHat (`npm run solidhat:test`) on the SolidCash mock network.
- Run `npm run gate` before committing. It needs no network and no wallet.
- Values that may change belong in `config/jamin.json`; UI text belongs in `lang/en.json` and `lang/ms.json` with the same keys.
- Never print, log or commit the test wallet phrase, WIF or any private key. `.env` is ignored by git.
- Every mainnet broadcast must go through the spending budget check.
- Record decisions in `docs/decisions/NNNN-title.md`, measurements in `docs/MEASURED.md`, SolidCash issues in
  `docs/SOLIDCASH-FINDINGS.md`, and each SolidCash feature with the test that exercises it in `docs/FEATURES.md`.
- Keep modules small (about 300 lines or fewer). Commit messages in English.
