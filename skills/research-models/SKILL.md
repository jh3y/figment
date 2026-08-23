---
name: research-models
description: Research live Krea image models, schemas, capabilities, and costs against a Figment brief. Use before choosing a model or planning a probe or batch.
---

# Research Krea models

Read the project's `brief.md`, relevant decisions, reviewed outputs, and the immediate generation question. Identify the project stage and what the model must help decide: broad ideation, aesthetic exploration, reference fidelity, character consistency, editing, typography, applied mockups, or final production.

Refresh live metadata with `pnpm lab models --refresh --json`; never recommend from memory when discovery is available. Shortlist the plausible candidates from the refreshed catalogue rather than starting with a preferred model. Inspect every shortlisted model's exact schema with `pnpm lab models --schema <model> --json` before claiming reference support, editing inputs, parameter names, aspect ratios, resolution, or output capabilities.

Verify pricing and qualitative claims against current official Krea documentation when the live catalogue omits them. Record the catalogue refresh timestamp and source dates. When sources disagree, prefer the live schema for accepted inputs, call out the discrepancy, and do not silently choose the more convenient value. Treat cost as an estimate unless Krea reports actual job cost.

Compare a small but credible field—normally three to five models—on the criteria that affect this task. Include model and endpoint ID, stage fit, likely aesthetic or fidelity strengths, prompt adherence, reference and editing support, consistency implications, relevant controls, output sizes/formats, expected latency when officially available, per-image cost or “not exposed,” and important uncertainty. Clearly separate official facts from reasoned inference and evidence observed in this project's own outputs.

Rank the candidates and make a recommendation; do not merely list options. Consider speed and cost for broad probes, then fidelity, consistency, editing, typography, or reference control when the work advances. Do not default to the newest or most expensive model.

When documentation cannot distinguish the strongest candidates, propose a controlled bake-off using the same creative question, prompt intent, references, aspect ratio, and comparable resolution. One or two outputs per model is usually enough before committing to a larger batch. State the bake-off cost first and avoid claiming that one model is “best” without relevant evidence.

Save substantial research under the project's `notes/` directory so another human or agent can understand the recommendation later. End with a staged workflow such as cheap comparison → human review → consistency test → higher-fidelity production.

If live discovery or schema inspection fails, say what could not be verified and do not substitute exact remembered pricing.
