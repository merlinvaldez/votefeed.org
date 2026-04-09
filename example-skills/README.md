# Example Skills: Learning In Context

This project showcases a learning-first AI workflow.
The goal is to use AI to understand concepts, practice deliberately, and review work, instead of blindly vibe coding.

## Skills Used

1. `teach-me`
- Purpose: mentorship-first pair programming in the current repo.
- Default behavior: guide me step by step; do not take over implementation.
- Best use: when I want to code myself and learn why each change matters.

2. `question`
- Purpose: beginner-friendly explanation of repo code, errors, and programming concepts in context.
- Default behavior: inspect the relevant code first, then explain it in plain language with concrete references.
- Best use: when I am stuck on what the code is doing or why something is failing before I start changing it.

3. `quickstart-me`
- Purpose: beginner-first Markdown mini-project tutorials saved into the workspace.
- Default behavior: research current docs, write the tutorial to `quickstarts/`, and return only the file path in chat.
- Best use: when I need an end-to-end guided tutorial from zero before touching production code.

4. `correct-me`
- Purpose: review my code and reasoning, then coach minimal fixes.
- Default behavior: no auto-edits; provide a narrowly scoped annotated unified diff or annotated snippet.
- Best use: after I implement, to catch mistakes and tighten understanding.

5. `testing-plan`
- Purpose: branch-aware QA planning based on the actual diff against a base branch.
- Default behavior: compare the branch to `main`, inspect the changed surfaces, and return an unchecked test checklist with exact steps and expected results.
- Best use: before merge or release, when I need to know exactly how to verify app, API, Vercel, and Supabase changes.

## How I Use These Together

1. Learn the concept in isolation with `quickstart-me`.
2. Ask `question` to explain the existing repo code or the exact error path before making changes.
3. Implement it myself in-repo with `teach-me`.
4. Review and refine with `correct-me`.
5. Generate a concrete regression checklist with `testing-plan` before merging.

## Example Prompts

1. `[$quickstart-me](./example.quickstart-me.md) QUICKSTART: Teach me React Context for auth.`
2. `[$question](./example.question.md) Explain how the auth flow works in this repo like I am a beginner.`
3. `[$teach-me](./example.teach-me.md) Guide me to wire this into my existing app without writing the code for me.`
4. `[$correct-me](./example.correct-me.md) Review my AuthContext changes and give me the minimal diff to fix mistakes.`
5. `[$testing-plan](./example.testing-plan.md) Compare this branch against main and give me an exact manual QA checklist before I merge.`

## Why This Matters

- Better understanding before coding: I can inspect unfamiliar code and errors without jumping straight into blind edits.
- Better learning retention: I practice the implementation myself.
- Better code quality: changes are reviewed with targeted feedback.
- Better release confidence: I can verify the changed surfaces with an explicit checklist instead of improvised testing.
- Better velocity over time: less guesswork, fewer repeated mistakes.
