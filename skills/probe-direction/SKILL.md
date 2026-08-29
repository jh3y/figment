---
name: probe-direction
description: Design and run a deliberately small Krea image experiment that answers one creative question cheaply while preserving Figment provenance.
---

# Probe a direction

Read the brief, decisions, relevant references, and recent generations. Define one falsifiable question or hypothesis. Change as few variables as possible and normally use one to four outputs.

Use the live model workflow in `../research-models/SKILL.md` when the model or schema has not just been verified. Inspect references visually when they matter; never modify originals. For any reference, use the exact reference input field from the live model schema.

Before running, state the model, count, controlled variable, and estimated total cost (or that Krea does not expose one). Then call shared tooling:

```bash
pnpm lab probe <project> --model <id> --prompt <prompt> --count <n> \
  --category <category> --purpose <purpose> --hypothesis <question> --params '<json>'
```

Add `--reference <path> --reference-field <schema-field>` for an ordinary file in the project's `references/` directory. When the human names an existing Studio output, use `--reference-shot <number> --reference-field <schema-field>` so the CLI resolves the real local asset and preserves its source identity; do not copy the output or substitute its shot number into the prompt. Array-typed reference fields are detected from the live schema and wrapped automatically, so a single reference needs no extra flag; `--reference-array` remains available to force it. If the schema expects reference objects rather than plain URLs, add `--reference-template '{"url":"$url"}'` with any schema-supported strength fields. Use `--cost-per-image <usd>` when current official pricing is known but the live catalogue does not expose it.

After completion, inspect the local outputs, summarize evidence rather than taste alone, and add the conclusion to the probe manifest. Log a decision only if the human actually commits to a direction. If interrupted, run `pnpm lab reconcile <project>`; do not resubmit blindly.
