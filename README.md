# <img src="apps/studio/public/fig-avatar.png" width="42" alt="Figment mascot"> Figment

Figment is a clonable, agent-first creative lab for developing visual projects with the Krea API. A human and coding agent shape a brief, research live models, run inexpensive probes, preserve generation provenance, compare results, and prototype around the strongest directions.

The filesystem is the product memory. Projects are readable Markdown, JSON, and ordinary media files; Studio is a local visual surface over those files, not a second source of truth.

> **Early alpha:** Figment is usable today, but its interfaces and project schemas may still evolve. Image generation is the supported media workflow; Studio is local-first, and published gallery builds are read-only. Keep valuable work in Git or another backup and inspect generated static builds before publishing them.

## First five minutes

Requirements: Node.js 20+ and pnpm 10+.

```bash
git clone https://github.com/jh3y/figment.git your-studio-name
cd your-studio-name
pnpm install
cp .env.example .env
```

Replace `your-studio-name` with the name you want for your own creative studio directory.

1. Create a token in [Krea API Tokens](https://www.krea.ai/settings/api-tokens). Krea shows the full token only once.
2. Add it to `.env` as `KREA_API_KEY`.
3. Add prepaid funds at [Krea API balance](https://www.krea.ai/app/api/).
4. Confirm Figment can inspect the live catalogue:

```bash
pnpm lab models --refresh
pnpm lab projects
pnpm studio
```

Krea API billing is separate from Krea subscriptions and web-app compute units. A paid Krea plan does not automatically fund API requests. Only workspace owners can add API balance; Krea currently accepts preset amounts or a custom amount from $5. Never commit `.env` or paste a token into project files, prompts, screenshots, or chat.

## Start

Ask your coding agent: **“Start a new project.”** The agent should behave like a creative studio partner: understand the goal, develop the brief conversationally, investigate the right current models, propose inexpensive experiments, and explain what each round will help decide.

The human should not need to know Figment's workflow commands or prompt the agent through every stage. The agent should actively:

- ask the high-leverage questions needed to understand the goal, audience, deliverable, timing, constraints, and budget where relevant
- research and recommend the best current models for the brief before generating
- explain what should be tested next and why
- propose the cheapest useful probe before committing to a substantial batch
- interpret human grades and recommend which direction to develop
- suggest an appropriate prototype when a shortlisted generation is ready to be tested in context

For a direct CLI start:

```bash
pnpm lab new --title "Goob" --description "An original character study"
pnpm lab projects
pnpm studio
```

Studio opens at `http://127.0.0.1:4173`. It provides project browsing, briefs, decisions, references, a filtered gallery, image lightbox, provenance, and review controls. Reviews are atomically written back to generation JSON, and project status can be changed between active, paused, complete, and archived without editing files by hand. Both actions provide visible saving, saved, or failed feedback. The interface supports system, light, and dark themes; the preference stays local to the browser.

The repository starts with an empty `projects/` directory. Studio branding lives independently under `apps/studio/public/`, so it does not add example project state to a new clone.

Inside the lightbox, use the arrow keys to navigate and review without leaving the keyboard:

- `1` — Favourite: strongest direction
- `2` — Shortlist: worth developing
- `3` — Reject: stop pursuing
- `Esc` — close the lightbox

Favourite, Shortlist, and Reject are mutually exclusive toggles; select the active signal again to clear it. Numerical scoring is deliberately omitted so review remains directional rather than pseudo-precise.

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

Prototype folders appear in Studio with the rest of the project. A static prototype with an `index.html` can be previewed and opened immediately. Framework-based experiments remain independent: add a small `prototype.json` containing their localhost `url` and Studio will link to or embed the running prototype. See [`skills/prototype/SKILL.md`](skills/prototype/SKILL.md) for the optional manifest.

Studio watches the project tree while it is running, so new generations, references, prototypes, and agent edits appear after an automatic reload. The active project, section, gallery filters, and rejected visibility are restored after reloads; review writes are excluded from the reload loop so keyboard grading remains uninterrupted.

### Publish a gallery snapshot

```bash
pnpm studio:build
```

The build at `apps/studio/dist/` is a self-contained, read-only snapshot of the current projects, images, briefs, and static prototypes. It can be uploaded to any ordinary static host, including a subdirectory; it contains no Krea token and makes no Krea API calls. Continue grading in the local Studio because a static host cannot safely write back to the project filesystem. Rebuild whenever you want to publish a newer snapshot.

The creation timestamp determines the year. Existing projects are never moved when the calendar changes.

### Before inviting someone else

Run the same checks used for this repository:

```bash
pnpm typecheck
pnpm test
pnpm studio:build
```

The static build intentionally contains the project files and generated media visible in Studio. Review `apps/studio/dist/` before publishing if a local project contains private references, notes, prompts, or client work. API keys are never included.

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

If Krea returns `402 Payment Required`, the workspace API balance is empty even if the account has an active subscription. Top up at [krea.ai/app/api/](https://www.krea.ai/app/api/) and reconcile any existing job records before retrying.

## Provenance

Every batch has a `manifest.json`; every output has adjacent JSON containing prompt, model, exact parameters, Krea job ID, references and uploaded asset IDs, dimensions, seed when exposed, cost or labelled estimate, timing, status, raw provider response, parent lineage, and review. A job is not marked complete until its remote output has been downloaded beside that metadata.

Batch manifests also carry a concise creative category such as `headshots`, `character-dna`, `character-maps`, `aesthetics`, or `merch`. Studio exposes category separately from the exact batch so related experiments remain easy to find. Stable project-local shot numbers live in `shot-index.json`, making “compare #13 and #24” meaningful after new work is added.

Krea integration follows the current [developer documentation](https://docs.krea.ai/developers/introduction) and live model discovery rather than a permanently encoded model list. Image generation is the only implemented media workflow in this first milestone.

## Contributing and license

Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) for the repository contracts and release checks. Figment is available under the [MIT License](LICENSE).
