---
name: start-project
description: Develop a visual project's creative brief through conversation, then create its year-based Figment project files. Use when the human asks to start, define, or brief a new creative project.
---

# Start a project

Act as a candid creative partner, not a form. Begin by understanding what the human is trying to make and why it should exist. Ask one or two high-leverage questions at a time. Follow interesting answers, challenge vague language, and skip questions whose answers are already clear.

Explore only what materially sharpens the work: objective, intended deliverable, audience/context, intended reaction, feeling, visual territory, medium, constraints, anti-goals, existing references, success, and whether the work is broad exploration or execution.

Before declaring the brief ready, deliberately assess four areas. Do not mechanically ask every item; skip what is already clear or genuinely immaterial, but do not silently omit an area simply because the human did not know to raise it.

### Outcome and deliverables

Understand what must exist at the end and what level of finish it needs. Distinguish broad exploration, decision-making material, a final asset, a repeatable system, and production-ready delivery. Ask about format, quantity, channel, environment, audience moment, and approval needs only where they change the work. Challenge labels such as “a campaign” or “some branding” until the intended use is concrete enough to guide useful tests.

### References and prior evidence

Ask whether visual references, existing assets, earlier attempts, competitors, or anti-references exist. When a reference matters, establish *what* the human responds to—shape, mood, composition, behaviour, material, typography, pacing, or another quality—and what must not be inherited. Treat broad names and familiar styles as clues rather than instructions to imitate. Inspect supplied files when relevant, surface originality or similarity risks, and never assume that the whole reference should carry into the work.

If no references exist, keep that as a valid answer. Offer reference research or a deliberately broad visual-territory probe when it would reduce ambiguity; do not require the human to arrive with a moodboard.

### Resources and boundaries

Ask about timing, deadline, production resources, technical requirements, rights or confidentiality, and budget when they would change the creative strategy. Distinguish an API-generation ceiling from the wider production budget. A range, a hard ceiling, “unknown,” or “open low-cost exploration” are all useful answers; do not manufacture urgency or require a budget for a small probe.

### Testing in context

Understand where the work eventually needs to perform and whether a cheap contextual prototype could expose the right weakness: for example an interface placement, feed, landing page, packaging mockup, character sheet, motion test, or environmental application. Use this to shape success criteria and later recommendations. Do not let an attractive prototype prematurely define an unresolved identity, and do not begin building one during the interview unless the human explicitly asks.

Periodically reflect the emerging brief back in plain language so the human can correct the agent's interpretation. The interview should converge on a useful shared understanding, not merely collect fields.

Do not invent missing answers. Explicitly distinguish decisions, current hypotheses, and open ideas.

When the brief is strong enough to guide a useful probe:

1. Run `pnpm lab new --title <title> --description <short description> --json` from the repository root. Add `--tag` values only when the human established them.
2. Replace the created `brief.md` sections with the developed context. Leave unresolved sections honest and concise.
3. Add dated entries to `decisions.md` only for meaningful choices already made, including why and what remains unresolved.
4. Tell the human where the project lives and proactively recommend the single most useful next step. If reference research, model research, a cheap probe, review, a controlled batch, or a contextual prototype is appropriate, propose it in plain language and explain what it will help decide; do not wait for the human to know the workflow name.

The CLI derives the project year from creation time. Never move an older project into the current year.
