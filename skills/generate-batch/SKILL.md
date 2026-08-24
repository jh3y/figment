---
name: generate-batch
description: Plan and execute a controlled Figment image batch with Krea, explicit cost preflight, provenance, references, and resumable job state.
---

# Generate a batch

Read the brief, decisions, recent outputs, and human review signals that justify this batch. A batch is a deliberate experiment, not a pile of variations. Name its purpose, the variable being explored, constants, model, parameters, count, references, and any parent generation.

Before a substantial batch or a change of creative phase, hold a short creative checkpoint. Reflect back the current goal, what the review signals appear to favour or reject, and what decision the proposed batch will enable. Ask one or two high-leverage questions when the human's intent, deliverable, reason for grading, budget, or desired degree of exploration is ambiguous enough to change the batch. Do not infer *why* an image was favourited from the signal alone. A request for “more” is an invitation to frame useful next territories, not automatically repeat the previous prompt at greater volume.

Scale the count only after the experiment is well-defined. For a larger batch, explain why additional samples improve the decision rather than merely increasing choice, and structure separate batches when they answer different questions.

Refresh or verify the live model schema and pricing when they are not current. Calculate count × estimated per-image cost. Tell the human before an unexpectedly expensive operation; `pnpm lab generate` also requires `--yes` above four outputs.

Run shared tooling with explicit inputs:

```bash
pnpm lab generate <project> --model <id> --prompt <prompt> --count <n> \
  --category <category> --purpose <purpose> --variable <variable> --params '<json>' --yes
```

When the human identifies an existing output by its Studio number—“use #24,” for example—pass `--reference-shot 24` with the live schema's `--reference-field`. The CLI resolves the stable project-local number, uploads the actual local output, and records the source generation and shot number; do not copy it into `references/` or merely mention it in the prompt. Add `--parent <generation-id>` as well only when the new work is genuinely a derivation rather than simply informed by that image.

For ordinary project reference files, add `--reference <path>` and `--reference-field <schema-field>`; use `--reference-template` when the schema expects objects, and never alter originals. Reference images are structured model inputs and should remain separate from the textual prompt in provenance. Pass `--cost-per-image <usd>` when official current pricing was researched but is absent from live catalogue metadata.

The CLI writes the manifest and pending generation record before waiting, downloads successful outputs locally, and only then marks completion. On process or network interruption, run `pnpm lab reconcile <project>`. Never create replacement jobs until reconciliation shows the original failed or cancelled.
