# Compact Comments Implementation Plan

> Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply the compact discussion layout selected by the user.

**Architecture:** Retain the existing comment controller and theme. Correct nested container styling and present owner controls below the comment text.

**Tech Stack:** React, CSS, Vite, Playwright.

**Spec:** docs/superpowers/specs/2026-11-16-compact-comments-design.md

## Global Constraints

Preserve comment ownership, district filtering, vote state, and existing accessible control names. Add no dependencies.

## Review Focus

Mobile wrapping, visible avatars, long comments, keyboard focus, and menu placement.

### Task 1

- [x] Update comment markup in client/src/BillPage.jsx and styling in client/src/BillPage.css.
- [x] Run tests/helpers/district-comments-browser.cjs against the existing local preview.
- [x] Inspect desktop and mobile screenshots, including expanded comments and editing.
- [x] Run client lint, production build, and git diff --check.

## Verification

Browser regression passed posting, publishing, editing, reloading across tabs, vote-state preservation, and deleting a second owned comment. Desktop and 390px mobile views were inspected, including the focused editor and expanded discussion. Client lint, production build, and git diff --check passed. Static review found no important regressions. The existing local Vite NODE_ENV warning persists. Clerk profile photos use the existing component, with initials shown when the photo is unavailable.
