# Contributing

Figment is an early-alpha, local-first creative lab. Small, focused changes that strengthen the human-and-agent creative loop are welcome.

## Setup

Use Node.js 20+ and the pnpm version declared in `package.json`.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm typecheck
pnpm test
pnpm studio:build
```

A Krea token is only required for live catalogue, upload, and generation commands. Tests and the Studio build must work without credentials.

## Repository contracts

- The filesystem is the source of truth. Do not introduce parallel application state for project data.
- Keep projects human-readable and preserve existing briefs, decisions, references, provenance, reviews, and lineage.
- Never commit credentials or alter original reference assets.
- Keep Krea calls inside `packages/krea/`; discover live models and schemas instead of hard-coding provider assumptions.
- Prefer targeted probes before costly batches, and clearly distinguish estimated, actual, and unavailable costs.
- Keep Studio an interface over project files. Local writes must be safe and static builds must remain read-only.
- Do not blanket-ignore `projects/`; generated assets and creative history may be intentionally committed.

## Pull requests

Explain the user-facing outcome, note any project-schema or filesystem changes, and include the commands used to verify the work. Never include private project material in fixtures or screenshots. New dependencies should have a clear benefit and a deliberately small scope.
