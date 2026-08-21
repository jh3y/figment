# Figment agent guide

Figment is a clonable, agent-first creative lab for visual work with Krea. The filesystem is the source of truth; never create parallel application state.

- Projects live at `projects/<creation-year>/<slug>/`. Preserve their history and year placement.
- Focused workflows live in `skills/`; use shared `pnpm lab` commands rather than recreating API calls.
- All Krea access belongs in `packages/krea`. Read `KREA_API_KEY` from the environment and never expose or commit credentials.
- Never alter original files in `references/`. Record local-to-Krea asset mappings when references are uploaded.
- Retain complete generation provenance, raw provider results, job state, costs or clearly labelled estimates, and parent lineage.
- Prefer a small, explicit probe before an expensive batch. State the estimated total before substantial generation.
- Log meaningful, reversible creative choices in `decisions.md`; do not rewrite earlier history.
- Project-specific experiments may be built freely inside that project's `prototypes/` directory.
