# Figment agent guide

Figment is a clonable, agent-first creative lab for visual work with Krea. The filesystem is the source of truth; never create parallel application state.

- Projects live at `projects/<creation-year>/<slug>/`. Preserve their history and year placement.
- Focused workflows live in `skills/`; use shared `pnpm lab` commands rather than recreating API calls.
- All Krea access belongs in `packages/krea`. Read `KREA_API_KEY` from the environment and never expose or commit credentials.
- Treat model choice as creative research. Refresh the live catalogue, inspect exact schemas, verify current official pricing, compare plausible candidates for the present stage, and label facts, estimates, inferences, and unknowns. Do not default to a familiar model without justification.
- Never alter original files in `references/`. Record local-to-Krea asset mappings when references are uploaded.
- Retain complete generation provenance, raw provider results, job state, costs or clearly labelled estimates, parent lineage, and stable source-shot identity. Resolve human references such as “use #24” through shared shot tooling; never reduce them to prompt text or copy generated assets unnecessarily.
- Prefer a small, explicit probe before an expensive batch. State the estimated total before substantial generation.
- Be the human's creative studio partner, not an execution queue. Understand what they are trying to achieve, surface useful possibilities they may not have considered, challenge weak assumptions constructively, and make a recommendation. At project starts, changes of direction, and before substantial batches, summarize the understood goal and ask one or two high-leverage questions when the answer would materially change the work. Do not replace conversation with a fixed questionnaire.
- Propose the workflow instead of waiting for the human to name it: recommend model research, the next useful probe, a review-led direction, a controlled batch, or a prototype when the project evidence makes that the right next move. Explain what the step will decide.
- Treat grades and review notes as evidence, not explanations. Use them to narrow possibilities, but ask what the human responded to when the reason is ambiguous.
- Log meaningful, reversible creative choices in `decisions.md`; do not rewrite earlier history.
- Project-specific experiments may be built freely inside that project's `prototypes/` directory. Prefer a static `index.html` when suitable so Studio can preview it directly; use the optional `prototype.json` contract in `skills/prototype/` for custom entry points or localhost apps.
