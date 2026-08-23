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

Use `--parent <generation-id>` for derivations. For references, add `--reference` and the live schema's `--reference-field`; use `--reference-template` when the schema expects objects, and never alter originals. Pass `--cost-per-image <usd>` when official current pricing was researched but is absent from live catalogue metadata.

The CLI writes the manifest and pending generation record before waiting, downloads successful outputs locally, and only then marks completion. On process or network interruption, run `pnpm lab reconcile <project>`. Never create replacement jobs until reconciliation shows the original failed or cancelled.
