# Figment

Figment is a clonable, agent-first creative lab for developing visual projects with the Krea API. A human and coding agent shape a brief, research live models, run inexpensive probes, preserve generation provenance, compare results, and prototype around the strongest directions.

The filesystem is the product memory. Projects are readable Markdown, JSON, and ordinary media files; Studio is a local visual surface over those files, not a second source of truth.

## Install

Requirements: Node.js 20+ and pnpm 10+.

```bash
pnpm install
cp .env.example .env
```

Create a token in [Krea API Tokens](https://krea.ai/app/api/tokens), add it to `.env` as `KREA_API_KEY`, and fund the separate API balance if needed. Never commit `.env`.

## Start

Ask your coding agent: **“Start a new project.”** The `start-project` skill develops the creative brief conversationally and creates the project only once there is enough honest context.

For a direct CLI start:

```bash
pnpm lab new --title "Goob" --description "An original character study"
pnpm lab projects
pnpm studio
```

Studio opens at `http://127.0.0.1:4173`. It provides project browsing, briefs, decisions, references, a filtered gallery, image lightbox, provenance, and review controls. Reviews are atomically written back to generation JSON.

## Project anatomy

```text
projects/2026/goob/
├── brief.md                 evolving human/agent context
├── decisions.md             dated meaningful choices
├── project.json             small structured metadata
├── references/              untouched original source material
├── probes/                  small question-led experiments
├── generations/             controlled production batches
├── prototypes/              project-specific experiments
└── notes/
```

The creation timestamp determines the year. Existing projects are never moved when the calendar changes.

## Models and generation

Model IDs, capabilities, schemas, and any exposed price metadata are refreshed from Krea rather than encoded here:

```bash
pnpm lab models --refresh
pnpm lab models --schema <model-id> --json
```

Run a small probe after inspecting the exact model schema:

```bash
pnpm lab probe goob \
  --model <model-id> \
  --prompt "documentary portrait of a small unfamiliar creature" \
  --purpose "documentary face study" \
  --hypothesis "physical realism makes the fiction more convincing" \
  --params '{"aspect_ratio":"1:1"}'
```

To use a local reference, keep it inside the project's `references/` directory, inspect the live schema, then add `--reference <path> --reference-field <exact-schema-field>`. For object-shaped reference arrays, add `--reference-array --reference-template '{"url":"$url"}'` and any model-supported fields. Figment uploads a Krea asset and stores the mapping in `references/.krea-assets.json` without changing the source file.

Use `pnpm lab generate` for a controlled batch. Pass a recently researched `--cost-per-image` when Krea's live catalogue omits price metadata. Larger or estimated-over-$1 batches require `--yes` after the cost preflight. If a process is interrupted, run `pnpm lab reconcile <project>` before considering a retry.

## Provenance

Every batch has a `manifest.json`; every output has adjacent JSON containing prompt, model, exact parameters, Krea job ID, references and uploaded asset IDs, dimensions, seed when exposed, cost or labelled estimate, timing, status, raw provider response, parent lineage, and review. A job is not marked complete until its remote output has been downloaded beside that metadata.

Krea integration follows the current [API reference](https://www.krea.ai/docs/api-reference/introduction), [MCP model discovery](https://www.krea.ai/docs/developers/mcp), and [job lifecycle](https://www.krea.ai/docs/developers/job-lifecycle). Image generation is the only implemented media workflow in this first milestone.
