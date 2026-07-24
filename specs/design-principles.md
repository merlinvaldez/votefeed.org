# VoteFeed Design Principles

Last updated: 2026-05-11

This file captures the interface and interaction principles that should guide VoteFeed across screens and features.

It exists to reduce cognitive load, keep the experience consistent, and prevent repeated design decisions from being re-made feature by feature.

## How To Use This File

Use this file when making decisions about:

- layout density
- helper copy
- button labels
- progressive disclosure
- action panels
- interaction feedback
- repeated UI patterns

Do not use this file for:

- product scope or mission
- implementation or deployment truth
- feature sequencing or rollout status

Those belong in `specs/mission.md`, `specs/tech-stack.md`, and `specs/roadmap.md`.

## The Design Goal

VoteFeed should help a person move from uncertainty to real civic action without making them fight through noise.

The app should feel:

- clear
- calm
- trustworthy
- actionable

When a screen feels overwhelming, the default assumption should be that the interface is showing too much too early.

## Core Principles

### Reduce Cognitive Load By Default

Show the least amount of information needed for the user to make the next decision.

The default state of the interface should be easy to scan. Extra explanation, duplicate labels, and long instructional copy should not appear all at once unless the user clearly needs them.

If a screen feels crowded, the first move should usually be to hide secondary information until the user expresses intent.

### Use Progressive Disclosure

VoteFeed should reveal complexity in steps.

Controls should stay compact until the user shows intent. Expanded copy, scripts, templates, helper text, and secondary actions should appear only after the related choice has been made.

This means:

- inactive controls can stay minimal
- selected controls can reveal fuller context
- helper panels should open after a deliberate action, not by default
- feedback should appear after interaction, not before

### Keep Interaction Patterns DRY

DRY does not only apply to code. It also applies to interface behavior.

If two parts of the app solve the same interaction problem, they should start from the same pattern unless there is a strong reason not to.

That includes:

- how stance buttons behave
- when helper text appears
- how scripts and templates are revealed
- how feedback messages appear
- how repeated civic action controls are labeled

Before inventing a new interaction pattern, check whether the app already has one that solves the same problem cleanly.

### Prefer Real Action Over Decorative UI

VoteFeed is not trying to be a noisy political content product.

The interface should prioritize helping the user:

1. understand what happened
2. decide where they stand
3. respond through a real path

Decorative UI, extra explanation, or repeated controls should not compete with that path.

### Put Context Close To The Decision

Users should not have to remember information from one part of the screen while acting in another.

Important context should appear near the interaction it supports. If helper text or a script is shown, it should be clearly tied to the bill, vote, or representative the user is acting on.

That context should be specific, but still concise.

### Use Copy That Builds Trust

Copy should be direct and plain.

The interface should not imply that VoteFeed took an action when the user still needs to take it themselves. If a script, draft, or template is provided, the product should make clear that it is a tool for the user, not an action already completed.

If something is unavailable, uncertain, or missing, the UI should say that plainly instead of using vague filler copy.

## Pattern Defaults

These are the default interaction choices unless a feature has a strong reason to do something else.

### Compact First State

Start with the smallest useful version of a control.

Examples:

- an icon-only action at rest
- a short label before expansion
- a hidden helper panel until selection

### Expanded Selected State

When a user selects or opens something, the interface can reveal fuller wording or supporting context.

Examples:

- selected stance buttons can reveal the full sentence label
- selected action buttons can open the relevant script or template
- post-action notices can show success or error feedback

### One Surface, One Job

Each area of the UI should have a clear main purpose.

If a section is for choosing a stance, it should not also front-load all instructional copy, all possible next actions, and all backup explanation at the same time.

## Review Checklist

Before shipping a UI change, ask:

- Is the default state compact?
- Is any text visible before the user actually needs it?
- Can secondary information be revealed later instead?
- Is this interaction pattern already solved somewhere else in the app?
- Is the UI helping the user move toward a real civic action?
- Does the copy stay clear about what VoteFeed does and what the user still needs to do?

## Change Rule

If a future design decision conflicts with this file, the change should be explicit.

Do not silently drift into a noisier or more generic interaction model one component at a time. If the philosophy changes, update this file first so the rest of the app has a durable reference point.
