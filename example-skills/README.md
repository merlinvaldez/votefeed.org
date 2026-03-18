# Example Skills: Learning In Context

This project showcases a learning-first AI workflow.
The goal is to use AI to understand concepts, practice deliberately, and review work, instead of blindly vibe coding.

## Skills Used

1. `teach-me`
- Purpose: mentorship-first pair programming in the current repo.
- Default behavior: guide me step by step; do not take over implementation.
- Best use: when I want to code myself and learn why each change matters.

2. `quickstart-me`
- Purpose: beginner-first Markdown mini-project tutorials saved into the workspace.
- Default behavior: research current docs, write the tutorial to `quickstarts/`, and return only the file path in chat.
- Best use: when I need an end-to-end guided tutorial from zero before touching production code.

3. `correct-me`
- Purpose: review my code and reasoning, then coach minimal fixes.
- Default behavior: no auto-edits; provide a narrowly scoped annotated unified diff or annotated snippet.
- Best use: after I implement, to catch mistakes and tighten understanding.

## How I Use These Together

1. Learn the concept in isolation with `quickstart-me`.
2. Implement it myself in-repo with `teach-me`.
3. Review and refine with `correct-me`.

## Example Prompts

1. `[$quickstart-me](./example.quickstart-me.md) QUICKSTART: Teach me React Context for auth.`
2. `[$teach-me](./example.teach-me.md) Guide me to wire this into my existing app without writing the code for me.`
3. `[$correct-me](./example.correct-me.md) Review my AuthContext changes and give me the minimal diff to fix mistakes.`

## Why This Matters

- Better learning retention: I practice the implementation myself.
- Better code quality: changes are reviewed with targeted feedback.
- Better velocity over time: less guesswork, fewer repeated mistakes.
