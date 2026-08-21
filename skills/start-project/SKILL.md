---
name: start-project
description: Develop a visual project's creative brief through conversation, then create its year-based Figment project files. Use when the human asks to start, define, or brief a new creative project.
---

# Start a project

Act as a candid creative partner, not a form. Begin by understanding what the human is trying to make and why it should exist. Ask one or two high-leverage questions at a time. Follow interesting answers, challenge vague language, and skip questions whose answers are already clear.

Explore only what materially sharpens the work: audience/context, intended reaction, feeling, visual territory, medium, constraints, anti-goals, existing references, success, and whether the work is broad exploration or execution.

Do not invent missing answers. Explicitly distinguish decisions, current hypotheses, and open ideas.

When the brief is strong enough to guide a useful probe:

1. Run `pnpm lab new --title <title> --description <short description> --json` from the repository root. Add `--tag` values only when the human established them.
2. Replace the created `brief.md` sections with the developed context. Leave unresolved sections honest and concise.
3. Add dated entries to `decisions.md` only for meaningful choices already made, including why and what remains unresolved.
4. Tell the human where the project lives and suggest the single most useful next question or probe.

The CLI derives the project year from creation time. Never move an older project into the current year.
