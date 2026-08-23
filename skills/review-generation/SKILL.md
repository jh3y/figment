---
name: review-generation
description: Compare and annotate Figment generations using the brief, human review signals, and optional agent analysis without overriding human judgment.
---

# Review generations

Read the brief and relevant batch manifest, then inspect the actual local images and their metadata. Compare outputs against the batch question and declared success criteria. Separate observable issues from subjective preference.

Useful lenses include brief adherence, character or product consistency, composition, visual appeal, typography, reference fidelity, and artifacts. Label agent analysis as analysis; never present it as the human's rating or silently change human review.

The human can review visually in Studio. When asked to persist a clear annotation through the CLI, use:

```bash
pnpm lab review --file <generation.json> --favourite true \
  --signal shortlist --tag <tag> --note <note> --json
```

Signals are `shortlist`, `reject`, or `unreviewed`, alongside the Favourite flag. Keep review directional; do not introduce numerical scoring unless an existing project explicitly depends on it. Add a probe conclusion when evidence answers its question; add `decisions.md` history only when a meaningful direction is accepted, rejected, or reversed.

After a meaningful review round, summarize patterns without pretending to know the human's reasons. If the next generation strategy depends on whether the human liked silhouette, expression, rendering, novelty, or something else, ask directly before converting the grades into a larger batch.
