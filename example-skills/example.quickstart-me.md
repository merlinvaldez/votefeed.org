---
name: quickstart-me
description: Generate beginner-first Markdown mini-project tutorials that are end-to-end and practical, then save them as markdown files in the current workspace. Use when the user asks for a quickstart, guided tutorial, or hands-on learning from zero. Each build step must include a short plain-language explanation and a short code snippet with inline comments explaining each line. Do not include "what to type" labels, separate line-by-line prose breakdowns, extra practice sections, common mistakes, or next steps. Always fetch current web documentation and at least one strong exemplar quickstart, and cite those sources directly in the tutorial.
---

# Skill: Quickstart Me

## Mission

Generate an end-to-end beginner tutorial as a Markdown mini project.
Teach from zero with small, well-explained code snippets and practical project flow.
Write the final tutorial to a markdown file in the current workspace instead of returning the full tutorial in chat.

## Default behavior

- Do not modify any repository code unless the user explicitly asks for implementation.
- Creating the tutorial markdown file is part of the skill output and is expected.
- Default to a scratch environment unless the user asks to apply it to an existing codebase.
- Assume the user is a total beginner to programming and computer science.
- Prioritize plain language and concept clarity over speed.
- Keep snippets short (typically 2 to 12 lines) and focused on one idea.
- Explain key patterns and concepts when they appear.

## File path format

- Do not output clickable links for local files inside the tutorial content.
- Do not use `vscode://`, `file://`, `http://`, or `https://` for local code references.
- Output plain absolute paths only, in this format:
- `/c:/Users/merli/Desktop/repos/coursework/voteFeed/<path-from-repo-root>`

## Documentation workflow (required)

Before writing the tutorial:

1. Query the web for up-to-date official documentation relevant to the stack.
2. Query at least one high-quality exemplar quickstart.
3. Prefer primary sources and official docs when available.
4. Use the retrieved docs to shape the tutorial sequence and terminology.
5. Cite links directly in the tutorial under a dedicated documentation section.

## File output workflow (required)

Before the final response:

1. Create a `quickstarts/` directory in the current workspace if it does not already exist.
2. Choose a concise file name based on the tutorial title in kebab-case, for example `daily-vote-feed-sync-api.md`.
3. Write the full tutorial to that markdown file.
4. If a file with that name already exists, overwrite it only if the user clearly wants a refreshed version; otherwise append a numeric suffix.
5. In chat, do not paste the full tutorial. Return only a short confirmation and the absolute path to the markdown file.

## Tutorial structure

Always output these sections in this order inside the markdown file.

1. Project Title

- A concise title for the mini project.

2. Goal

- One sentence describing what the user will build and understand.

3. What You Are Building

- Plain-language overview of the mini project.
- Explain why this project teaches useful beginner patterns.

4. Documentation References

- List source links used (official docs plus at least one exemplar quickstart).

5. Core Concepts

- Explain only the concepts needed for this mini project.
- Keep definitions short, concrete, and beginner-friendly.

6. Project Setup

- Provide setup commands and file scaffold in markdown code blocks.

7. Build Steps

- Use numbered steps from start to finish.
- For each step, include:
- a short explanation paragraph describing what this step does
- a code snippet with inline comments that explain each line
- why this step matters (one sentence)
- Do not use the labels `What to type:` or `What it is:`.

8. Run and Verify

- Show exactly how to run the mini project.
- Include a basic verification flow to confirm it works end-to-end.

9. Final Recap

- Briefly summarize what was built and what core patterns were learned.

## Forbidden sections

Do not include these sections unless the user explicitly asks for them:

- Micro-exercises
- Practice tasks
- Common mistakes
- Next steps

## Interaction rules

- Ask at most one lightweight clarifying question only when truly necessary.
- Otherwise, choose a reasonable default and proceed.
- If the topic is broad, narrow scope to one complete mini project.

## Output rules

- Write the tutorial to a markdown file in the workspace.
- Do not paste the full tutorial into chat.
- In chat, return a short confirmation plus the file path.
- Do not output diffs.
- Do not output patches.
- Keep the tutorial concrete and execution-ready.
- Ensure the tutorial is complete end-to-end.

## Code annotation rules

- Every sample snippet must contain inline comments that explain each line.
- Prefer same-line comments where language permits.
- Keep comments short and beginner-friendly.
- Do not add separate line-by-line prose walkthroughs outside the snippet unless the user asks.
- If a format cannot include comments (for example strict JSON), include:
- an annotated equivalent block (for example `jsonc`)
- a runnable block labeled `Runnable version`

## Style rules

- Use plain, concrete language.
- Define unavoidable jargon in one sentence.
- Keep explanations supportive and direct.
- Prefer short paragraphs and small snippets.

## Trigger examples

- "Quickstart me on building my first REST API."
- "Teach me React state with a complete beginner mini project."
- "Give me an end-to-end Node.js quickstart with docs links."
- "I want a markdown quickstart tutorial that starts from zero."

## Exemplar response behavior

- Create the tutorial markdown file in `quickstarts/`.
- Reply in chat with a brief confirmation and the absolute file path.
- Do not dump the tutorial body into chat.
