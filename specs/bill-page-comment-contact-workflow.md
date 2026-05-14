# VoteFeed Bill Page Comment And Contact Workflow Spec

Last updated: 2026-05-14

## Why This Exists

The bill page now has the core moderated comment flow in place, but this spec is still the source of truth for what the workflow is supposed to be and what remains unfinished.

I want the user's own bill comment to stay the bridge between:

- taking a position
- preparing a real outreach message
- optionally contributing something useful back to the public bill page

This spec now locks that behavior down and tracks the remaining implementation work.

## Current Repo Reality

Right now:

- `client/src/BillPage.jsx` gates comment creation behind a saved stance, renders the signed-in user's approved comment as its own owned row, and lazily loads cached-or-generated contact drafts only when the user opens `Call` or `Message`
- `server/src/api/interactions.js` supports draft save, moderation submit, owned comment delete, and an authenticated `contact-drafts` route for the approved comment
- `server/src/db/schema.sql` stores comment lifecycle state in `bill_comments`, includes `comment_useful_votes`, and now includes cached `call_script` and `message_template` columns
- `server/src/ai/commentModeration.js` handles server-side moderation and `server/src/utils/contactDraftPipeline.js` handles AI contact-draft generation
- the public toggle, public comment list, and useful-reaction flow are still not implemented end to end

That means the core owned-comment workflow is now real, but the public-comment layer is still incomplete.

## Product Outcome

On the bill page, an authenticated user should be able to:

- choose whether they agree or disagree with the bill
- write a bill-specific comment
- submit that comment through a moderation check
- get a gentle correction if the comment is inappropriate
- keep editing the blocked text without losing the draft
- choose whether the approved posted comment is public on VoteFeed
- see the phone-call and representative-message icons only under their own approved posted comment
- unlock the phone-call script and representative message draft only after the comment is successfully posted
- use a three-dot menu on their own comment to edit or delete it

Other users should be able to:

- see public comments on that bill
- mark a public comment as useful

VoteFeed should still prepare the script and draft for the user.

VoteFeed should not imply that it sent anything to the representative.

## Decisions I Am Locking For V1

- A user must choose `agree` or `disagree` on the bill before they are allowed to comment.
- The comment icon should remain hidden until that bill interaction has been set successfully.
- There is one active comment per user per bill in V1.
- Comment visibility defaults to private.
- Only an approved user-owned comment can unlock the phone and message helper panels.
- The call and message icons should render only on the signed-in user's own approved comment, never under other users' public comments.
- The signed-in user's own comment should expose a three-dot menu with `Edit` and `Delete`.
- Only an approved comment can be made public.
- Public comments can receive one simple `Useful` reaction per user.
- No replies, no nested threads, and no general-purpose social feed behavior in V1.
- If I want a heart icon in the UI, it still means `Useful`, not generic liking.

## Core Behavior Rule

The intended bill-page interaction is:

1. the user agrees or disagrees with the bill
2. that stance is saved as the user's bill interaction
3. once the interaction exists, the comment icon becomes visible
4. the user opens the comment composer from that icon, then writes and submits a comment
5. if the comment is approved, it is shown as the user's owned posted comment
6. only under that owned approved comment, VoteFeed shows the call and message icons and fetches cache-first AI drafts generated from that approved comment
7. that owned comment also exposes a three-dot menu for edit and delete actions

The scripts should not be created from stance alone.
The scripts should not be created from a blocked or still-unapproved draft.
The scripts should not appear under other users' public comments.

## User Flow

1. The user opens a bill page.
2. The user chooses `agree` or `disagree` on the bill.
3. The backend saves that choice as the user's bill interaction.
4. Once the interaction exists, a comment icon appears under or alongside the interaction controls.
5. The user taps the comment icon to open the composer.
6. The user writes a comment.
7. The user submits the comment.
8. The backend runs moderation using OpenAI's current supported moderation model.
9. If the comment is approved:
   - the comment is saved as the user's posted comment for that bill
   - the user's owned comment row shows a `Make public on VoteFeed` toggle, defaulted off
   - if the user turns that toggle on, the approved posted comment becomes visible in the public comments section
   - the user's owned comment row shows call and message icons
   - the user's owned comment row shows a three-dot menu with `Edit` and `Delete`
   - both scripts are loaded from a cache-first server-side AI pipeline that uses the approved comment plus the saved stance and bill context
10. If the comment is blocked:

- the comment stays in draft mode
- the draft text stays editable
- nothing becomes public
- the phone and message scripts stay hidden
- the UI shows a gentle explanation that the comment needs revision

11. If the user edits an already approved comment:
    - the new version becomes a draft again
    - moderation runs again on resubmission
    - the last approved version remains the active posted version until a replacement is approved
12. If the user deletes their comment:
    - the owned posted comment is removed
    - the call and message icons disappear with it
    - the public version is removed if that comment had been public

## Moderation Rules

- Moderation should happen server-side, not only in the client.
- The moderation result should be stored so the app can distinguish draft, approved, and blocked states.
- The user-facing rejection copy should stay calm and specific enough to be actionable, but not punitive.
- A moderation failure or timeout should not silently publish the comment.
- If moderation is unavailable, keep the draft intact and ask the user to try again.
- Blocked text should never be used to generate the phone script or message draft.

## Script Generation Rules

- The phone script and message draft should be based on the approved comment, not just the stance.
- In V1, the phone script and message draft should be generated server-side with AI and cached on the approved comment row.
- If cached drafts already exist for the current approved comment and stance, VoteFeed should return those saved drafts instead of generating them again.
- The user's own words should stay recognizable in the generated outreach text.
- Stance still matters because it frames whether the user agrees or disagrees with the representative's vote.
- If the comment is edited and re-approved, the scripts should refresh from the newest approved version.
- If the stance changes, the cached drafts should be invalidated and regenerated for the new stance framing.
- The call script should prioritize read-aloud readability with short spoken paragraphs, not one dense block of text.
- The message draft can be more polished than the call script, but it should still stay easy to scan and copy.

## Data Model Direction

The current `interactions.user_comment` field is not enough for this feature.

The repo now keeps `interactions` as the stance record and `bill_comments` as the dedicated comment lifecycle model.
The legacy `interactions.user_comment` field still exists and still needs an explicit cleanup or migration decision.

### Current table: `bill_comments`

- `id uuid primary key`
- `interaction_id integer not null unique references interactions(id) on delete cascade`
- `user_id integer not null references users(id) on delete cascade`
- `bill_id integer not null references bills(id) on delete cascade`
- `rep_bioguide_id text not null references reps(bioguideId)`
- `draft_text text`
- `approved_text text`
- `call_script text`
- `message_template text`
- `moderation_status text not null`
- `moderation_reason text`
- `moderation_categories jsonb`
- `is_public boolean not null default false`
- `last_submitted_at timestamptz`
- `last_moderated_at timestamptz`
- `published_at timestamptz`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Current repo status values cover:

- `draft`
- `approved`
- `blocked`

If moderation ever becomes asynchronous later, `pending_moderation` can be added intentionally instead of implied.

### Current table: `comment_useful_votes`

- `comment_id uuid not null references bill_comments(id) on delete cascade`
- `user_id integer not null references users(id) on delete cascade`
- `created_at timestamptz not null default now()`
- unique index on `(comment_id, user_id)`

## Backend API Direction

I do not need a fully social API surface yet.

I do need the backend to support the full comment lifecycle cleanly.

### Interaction and comment endpoints

- create or keep the stance interaction first
- save a draft comment against that interaction
- submit a draft for moderation
- fetch cache-first call and message drafts for an approved owned comment
- update the public/private flag
- fetch the current user's interaction plus comment state for the bill page
- fetch approved public comments for a bill
- toggle a `Useful` reaction on a public comment

### Suggested response shape for the bill page

The bill page should be able to load one response that includes:

- stance
- comment lifecycle status
- draft text
- approved text
- public flag
- moderation feedback message
- useful count for the user's own public comment

That avoids scattering the bill-page state across too many separate requests.

The current repo intentionally keeps contact drafts out of that main bill-page payload.
They are fetched lazily from a dedicated route because the route may hit AI on a cache miss.

## Frontend Behavior Direction

### Composer behavior

- Keep the comment icon hidden until the interaction exists.
- Show the composer only after the user chooses the comment icon.
- Preserve draft text while the user edits.
- On blocked moderation, keep the text in place and show a gentle inline notice.

### Action-panel behavior

- Hide call and message buttons until there is an approved user-owned comment.
- Render the call and message icons only inside the signed-in user's own approved comment card or row.
- Never render call and message icons under another user's public comment.
- Keep the current progressive-disclosure pattern where action panels appear only after the user chooses them.
- Load the script content lazily from the server-side cache-first contact-draft route.
- Rebuild the script content from the approved comment instead of the old stance placeholder text.
- Show a small loading state while the contact drafts are being prepared.

### Owned comment controls

- The signed-in user's own posted comment should have a three-dot menu.
- That menu should offer `Edit` and `Delete`.
- The signed-in user's own approved posted comment should also show a `Make public on VoteFeed` toggle.
- That public toggle should default to off.
- `Edit` should reopen the composer with the current comment text so the user can revise and resubmit.
- While the user is editing, the composer should replace the posted comment row instead of duplicating it below.
- `Delete` should remove the user's comment and any UI that depends on that approved comment.

### Public comment behavior

- Show a public comments section on the bill page below the user's own action area.
- Public comments should show the author's first name or another privacy-safe display label, not full private profile data by default.
- Guests may read public comments, but only authenticated users can mark them as useful.
- A user should not be able to mark their own comment as useful.
- Public comments should not show call, message, edit, or delete controls unless the rendered comment is the signed-in user's own owned comment surface.

## Migration Rule

There may already be legacy data in `interactions.user_comment`.

I should not silently auto-publish any legacy comments.

The safe implementation choices are:

- backfill old comments into `bill_comments` as private, non-public, legacy records
- or leave them unread from the new UI and explicitly archive that field later

The implementation task should make that choice deliberately instead of letting the old field linger as an accidental source of truth.

## Task Breakdown

### Task 1: Add the comment lifecycle schema

Work:

- add `bill_comments`
- add `comment_useful_votes`
- add indexes for bill lookup, user lookup, and unique useful reactions
- decide how legacy `interactions.user_comment` rows are handled

Likely files:

- `server/src/db/schema.sql`
- any schema-reset or migration helper the repo already uses

### Task 2: Build the backend comment query layer

Work:

- add query helpers for draft save, moderation-state update, approved-comment publish, comment delete, public-visibility toggling, public comment listing, and useful-reaction toggling
- stop treating `interactions.user_comment` as the primary runtime field

Likely files:

- `server/src/db/queries/interactions.js`
- new `server/src/db/queries/comments.js`

### Task 3: Add the moderation service

Work:

- create a server-side moderation module that calls OpenAI moderation
- map moderation output into VoteFeed statuses and user-facing rejection messages
- fail closed when moderation errors out

Likely files:

- new `server/src/ai/commentModeration.js`
- `server/example.env`
- any deployment env documentation that needs the OpenAI key called out clearly

### Task 4: Extend the API for the full comment workflow

Work:

- add draft-save and submit-for-moderation endpoints
- return structured comment state to the bill page
- add an owned-comment edit flow and delete endpoint
- add an endpoint to toggle `Make public on VoteFeed` on an approved owned comment
- add public-comment list and useful-reaction endpoints
- enforce auth and ownership rules

Likely files:

- `server/src/api/interactions.js`
- new `server/src/api/comments.js` if splitting routes is cleaner
- `server/src/index.js` if a new route group is mounted

### Task 5: Rebuild the bill-page interaction flow

Work:

- keep stance selection as the first gate
- reveal the comment icon only after the interaction is created
- add the comment composer behind that icon
- wire draft save and submit behavior
- show gentle moderation feedback
- show the approved comment as a user-owned comment row
- show the `Make public on VoteFeed` toggle on that owned approved comment row
- show the three-dot menu with edit/delete on that owned comment row
- hide call and message actions until a user-owned comment is approved
- render call and message actions only under the user-owned approved comment

Likely files:

- `client/src/BillPage.jsx`
- `client/src/BillPage.css`

### Task 6: Add the AI contact-draft pipeline

Work:

- replace the current stance-only placeholder reason text
- generate the phone script and message draft from approved comment text plus bill, district, representative, and stance context
- cache generated drafts on `bill_comments`
- return cached drafts on future requests for the same approved comment and stance
- invalidate cached drafts when a new approved comment lands or when stance changes
- keep the copy honest that VoteFeed is preparing text, not sending it

Likely files:

- `server/src/db/schema.sql`
- `server/src/db/queries/comments.js`
- `server/src/db/queries/interactions.js`
- `server/src/api/interactions.js`
- `server/src/utils/contactDraftPipeline.js`
- `server/src/ai/prompts/contactDraftMaker.md`
- `client/src/BillPage.jsx`

### Task 7: Add the public comments section and useful reactions

Work:

- load approved public comments for the bill
- render them in a compact, readable list
- add the `Useful` toggle and count
- block self-reactions
- ensure the public comment list does not render call/message or edit/delete controls for other users' comments

Likely files:

- `client/src/BillPage.jsx`
- `client/src/BillPage.css`
- backend files from Tasks 2 through 4

### Task 8: Add guardrails, observability, and QA coverage

Work:

- log moderation failures and blocked-comment outcomes without leaking unnecessary sensitive text
- verify unauthorized users cannot edit other users' comments or spam useful reactions
- verify scripts never appear for blocked or draft-only comments
- verify public/private switching behaves correctly
- verify the public toggle appears only after approval on the owned comment row
- verify the three-dot menu appears only on the signed-in user's own comment
- update stack docs if the schema and env surfaces change

Likely files:

- backend route and service files
- `specs/tech-stack.md`

## Progress Snapshot

Status key:

- `[x]` done
- `[~]` in progress
- `[ ]` not started

Current repo progress as of 2026-05-14:

- `[~]` Task 1: schema foundation is in place in `server/src/db/schema.sql` with `bill_comments`, `comment_useful_votes`, and cached `call_script` / `message_template` columns, but follow-up indexes and the legacy `interactions.user_comment` plan are still open
- `[~]` Task 2: the backend query layer now supports draft save, moderation-result persistence, owned delete, and cache-first contact-draft reads, but does not yet support public toggling, public listing, or useful reactions
- `[x]` Task 3: the server-side OpenAI moderation module exists, returns VoteFeed-specific statuses, and fails closed when moderation is unavailable
- `[~]` Task 4: draft-save, submit-for-moderation, owned delete, and contact-draft endpoints exist, and the bill-page read shape returns comment lifecycle state, but public-toggle, public-comment, and useful-reaction endpoints are still missing
- `[~]` Task 5: the bill page now has the interaction-gated comment icon, composer, draft persistence, submit flow, blocked-comment feedback, approved owned comment row, call/message icons, and three-dot menu with edit/delete, but it does not yet include the public toggle
- `[x]` Task 6: call and message drafts now use a server-side AI pipeline built from the approved comment, saved stance, and bill context, with cache-first reads and invalidation on re-approval or stance change
- `[ ]` Task 7: the public comments list and `Useful` reactions are not yet implemented beyond the schema foundation
- `[~]` Task 8: core ownership enforcement and targeted build/syntax validation exist, but dedicated QA coverage, public-comment guardrail verification, and `specs/tech-stack.md` updates are still pending

## Implementation Checklist

1. `[x]` Add `bill_comments` and `comment_useful_votes` to the schema.
2. `[ ]` Decide what happens to legacy `interactions.user_comment` data and document that choice in the implementation.
3. `[~]` Build query helpers for draft save, moderation result save, cache-first contact drafts, public toggle, delete, public list fetch, and useful-vote toggle.
4. `[x]` Add a server-side OpenAI moderation module and map its output into `draft`, `approved`, and `blocked` behavior.
5. `[~]` Add endpoints for:
   - saving a draft comment
   - submitting a draft for moderation
   - fetching cache-first contact drafts for an approved owned comment
   - editing an owned comment through the existing draft and resubmit flow
   - deleting an owned comment
   - toggling `Make public on VoteFeed`
   - loading public comments for a bill
   - toggling `Useful` on a public comment
6. `[x]` Update the bill-page load shape so the client receives stance state plus the user's current comment lifecycle state in one response.
7. `[x]` Add the interaction-gated comment icon so it appears only after `agree` or `disagree` has been saved.
8. `[x]` Add the comment composer flow with draft persistence and gentle moderation feedback.
9. `[~]` Render the approved owned comment row with:
   - the `Make public on VoteFeed` toggle
   - the call and message icons
   - the three-dot menu with `Edit` and `Delete`
10. `[x]` Make sure call and message icons render only on the signed-in user's own approved comment and never on other public comments.
11. `[ ]` Build the public comments list with privacy-safe author labels and `Useful` reactions.
12. `[~]` Verify the full flow end to end, then update `specs/tech-stack.md` if the schema, API shape, or env requirements changed.

## Acceptance Criteria

- A signed-in user can choose `agree` or `disagree` on the bill, which creates the interaction record.
- The comment icon appears only after that interaction exists.
- From that icon, the user can open the composer, write a comment, and submit it.
- An appropriate comment becomes approved and unlocks the call and message helpers.
- After approval, the signed-in user's own posted comment shows a `Make public on VoteFeed` toggle that defaults to off.
- The call and message icons appear only under the signed-in user's own approved posted comment.
- The signed-in user's own posted comment includes a three-dot menu with `Edit` and `Delete`.
- An inappropriate comment is blocked gently, remains editable, and does not unlock scripts.
- Public visibility is optional and defaults to off.
- Only approved public comments appear in the bill-page public comments list.
- Another authenticated user can mark a public comment as useful exactly once.
- The call script and message draft are generated server-side from the user's approved comment, not from stance alone.
- Cached drafts are reused when they already exist for the current approved comment and stance.
- VoteFeed never claims that it sent the outreach on the user's behalf.

## Out Of Scope For This Spec

- direct delivery into congressional systems
- threaded comment replies
- generic bill-page chat
- recommendation ranking for comments
- AI rewriting of the user's posted bill comment itself
