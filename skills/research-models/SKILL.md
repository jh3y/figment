---
name: research-models
description: Research live Krea image models, schemas, capabilities, and costs against a Figment brief. Use before choosing a model or planning a probe or batch.
---

# Research Krea models

Read the project's `brief.md`, relevant decisions, and the immediate generation question. Refresh live metadata with `pnpm lab models --refresh --json`; never recommend from memory when discovery is available.

Shortlist only plausible image models. Inspect each exact schema with `pnpm lab models --schema <model> --json` before claiming reference support, parameters, aspect ratios, resolution, or output capabilities. Treat pricing as an estimate unless Krea reports actual job cost. Always state the catalogue refresh timestamp.

Rank a small set by suitability for this stage: speed and cost for broad probes; fidelity, consistency, editing, typography, or reference control only when relevant. Do not default to the highest-priced option.

Return a small ranked recommendation containing model ID, best use here, reference/schema fit, approximate per-image cost or “not exposed,” and a concise reason. End with a staged workflow such as cheap probe → shortlist → higher-fidelity test.

If live discovery or schema inspection fails, say what could not be verified and do not substitute exact remembered pricing.
