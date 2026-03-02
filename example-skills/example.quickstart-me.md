---
name: quickstart-me
description: Generate small learn-by-doing quickstarts for concepts, tools, patterns, and features. Use when the user asks to learn something quickly, wants a hands-on tutorial, asks for a "quickstart", or needs a 10-20 minute scratch-environment walkthrough. Always annotate sample code line-by-line so each line explains itself.
---

# Skill: Quickstart Me

## Mission

Generate a compact, learn-by-doing quickstart that the user can finish in 10 to 20 minutes in a scratch environment.

## Default behavior

- Do not modify any repository.
- Do not assume the user wants to apply this to an existing codebase.
- Default to a scratch setup: browser console, CodeSandbox, Replit, or a single local folder.
- Keep it minimal: one file when possible, two files maximum unless absolutely necessary.
- Assume the user is learning; prioritize clarity over cleverness.

## Quickstart structure

Always output these sections in this order.

1. Goal (1 sentence)

- State exactly what the user will be able to do or understand by the end.

2. What it is (plain language)

- Explain what it is, why it matters, and when to use it.

3. Mental model (tiny analogy + key rules)

- Give one short analogy.
- Give the most helpful principles for the concept (usually 3 to 7 rules).

4. Setup

- Provide exact run instructions with copy/paste commands or clear "open this page/console" guidance.
- If the environment is unspecified, default to:
- Browser console for basic JavaScript concepts.
- Node (latest LTS) for file or CLI examples.

5. Build it (numbered steps)

- For each step, include:
- what to type
- what the user should see
- why it matters (one sentence)
- After each major step, include exactly:
- "Tell me what you got and I'll give you the next step."

6. Micro-exercises (increasing difficulty)

- Provide as many exercises as needed to meet the goal (typically 3 to 8).
- For each exercise, include:
- prompt
- expected output or success criteria
- one optional hint

7. Common mistakes (top 5)

- For each mistake, include:
- what goes wrong
- how to recognize it
- how to fix it

8. Next steps (pick one)

- Offer exactly three paths:
- Practice more (more exercises)
- Vary the constraints (same concept, different scenario)
- Deepen understanding (one deeper concept plus a tiny follow-up quickstart)

## Interaction rules

- Ask at most one lightweight clarifying question only when necessary.
- Otherwise, choose a reasonable default and proceed.

## Output rules

- Use headings and numbered lists.
- Do not output diffs.
- Do not output patches.

## Code annotation rules

- Any sample code must be line-by-line annotated.
- Each non-empty code line must include an explanatory comment on that same line, or a directly adjacent comment line that explains it.
- Prefer inline comments when the language supports them.
- Keep comments short and beginner-friendly.
- If the format does not allow comments (for example strict JSON), provide:
- an annotated teaching block in a comment-capable equivalent (for example `jsonc`), and
- a second runnable block labeled `Runnable version`.
- Keep runnable blocks copy/paste executable.

## Style rules

- Keep language plain and concrete.
- Prefer short steps over long explanations.
- Keep examples executable immediately without hidden setup.
- Use safe defaults and avoid destructive commands.

## Trigger examples

- "QUICKSTART: Teach me loops in JavaScript."
- "Give me a quickstart for REST APIs in Node."
- "Teach me React state in 15 minutes."
- "I want a hands-on intro to SQL joins."