---
name: prototype
description: Create or evolve a project-specific prototype inside Figment while following that project's brief and preserving generated-asset provenance.
---

# Prototype within a project

Read `brief.md`, `decisions.md`, and the metadata for any generated assets being used. Confirm which creative question the prototype should answer, then work only inside `projects/<year>/<slug>/prototypes/<prototype-name>/`.

Choose the lightest technology suited to that prototype; prototypes do not have to use Studio's stack. Keep them self-contained and add a short README only when run instructions or the experiment's purpose would otherwise be unclear.

Make the result browsable in Studio when practical:

- A self-contained static prototype needs only an `index.html`; use relative asset paths so Studio can serve and embed it directly.
- A prototype with its own development server may add `prototype.json` with `title`, optional `description`, `url`, and optional `embed` (defaults to `true`). The URL should normally be a localhost address and its README must include the start command.
- `prototype.json` may instead use `entry` to point at a static HTML file other than `index.html`.

Example:

```json
{
  "title": "Landing page study",
  "description": "Tests Fig as a quiet guide through an empty canvas.",
  "url": "http://127.0.0.1:3000",
  "embed": true
}
```

Do not copy an asset without retaining a clear link to its source generation, and never modify original files in `references/`. Do not add prototype-specific state or dependencies to Studio unless the human explicitly asks to productize the experiment.
