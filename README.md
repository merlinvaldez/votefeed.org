# voteFeed

## 30 Second Pitch

VoteFeed is a Twitter/Bluesky-like user experience that lets constituents see how their U.S. House representative has voted and respond to those votes with approval, disapproval, and comments.

## MVP V1 Features (FSA Release)

- Any user can enter an address and see a cascading feed of their district's assigned U.S. representative's voting record.
  - Determine congressional district from an address with the U.S. Census Geocoder API.
  - Get the representative serving that district from Congress.gov.
  - Get House vote data and member-by-member vote records from Congress.gov.
- Users can register and log in.
- Authorized users can:
  - Save their address, district, and U.S. House representative.
  - Approve or disapprove of a bill.
  - Leave a comment explaining their position.

## MVP V2 Features (Public Release)

- Organize the feed based on bill interests.
- Show how other constituents in the district are voting and commenting on bills.
- Show more bill and representative information, such as:
  - Vote date
  - Bill type
  - Bill contents
  - Representative photo
  - Representative page link
- Add third-party login/signup.
- Send authorized users' comments directly to representatives by email.
- Moderate comment language.
- Show how closely the user aligns with their representative.
- Notify users about new votes from their representative.

## Stretch Features

- Allow users to approve/disapprove and comment on bills before they are voted on.
- Show an upcoming legislative agenda feed.
- Link out to external bill documents.
- Generate AI pro/con bill breakdowns.
- Use AI to help draft comments to representatives.
- Let users click into terms and ask "what is this?" for civic definitions.
- Ensure comments stay directed to the bill in question.

## Project Management System

[VoteFeed Dev](https://www.notion.so/VoteFeed-Dev-2c7155d4c85080bebe06d6905a3a50cf?pvs=21)

## Current DB Schema

This section reflects the current application schema in `server/src/db/schema.sql`, plus the unique indexes used in deployed sync workflows.

### users

| Column        | Type    | Constraints |
| ------------- | ------- | ----------- |
| id            | serial  | Primary key |
| email         | text    | Unique      |
| clerk_user_id | text    | Unique      |
| first_name    | text    | Nullable    |
| last_name     | text    | Nullable    |
| state         | text    | Nullable    |
| district      | integer | Nullable    |

### reps

| Column                | Type    | Constraints |
| --------------------- | ------- | ----------- |
| bioguideId            | text    | Primary key |
| full_name             | text    | Not null    |
| party                 | text    | Not null    |
| chamber               | text    | Not null    |
| state                 | text    | Not null    |
| congressionalDistrict | integer | Nullable    |

### bills

| Column    | Type    | Constraints |
| --------- | ------- | ----------- |
| id        | serial  | Primary key |
| number    | integer | Not null    |
| bill_type | text    | Nullable    |
| title     | text    | Not null    |
| summary   | text    | Not null    |
| aisummary | text    | Nullable    |

Deployed environments also use:

- `bills_bill_type_number_uidx` on `(bill_type, number)` so bill summaries can be safely upserted without duplicates.

### member_voting_record

| Column            | Type        | Constraints |
| ----------------- | ----------- | ----------- |
| id                | serial      | Primary key |
| legislationNumber | integer     | Nullable    |
| legislation_type  | text        | Nullable    |
| session_number    | integer     | Nullable    |
| roll_call_number  | integer     | Nullable    |
| voted_on          | timestamptz | Nullable    |
| vote              | text        | Not null    |
| member_id         | text        | Not null    |

Deployed environments also use:

- `member_voting_record_member_roll_call_uidx` on `(member_id, session_number, roll_call_number)` so vote sync stays idempotent.

### interactions

| Column       | Type    | Constraints                                                   |
| ------------ | ------- | ------------------------------------------------------------- |
| id           | serial  | Primary key                                                   |
| stance       | text    | Not null                                                      |
| user_comment | text    | Nullable                                                      |
| user_id      | integer | Not null, foreign key to `users(id)` with `ON DELETE CASCADE` |
| bill_id      | integer | Not null, foreign key to `bills(id)` with `ON DELETE CASCADE` |

## API Endpoints

High-level mounted API groups:

- `GET /districts/...`
- `GET /reps/...`
- `GET /bills/...`
- `GET /housevotes/...`
- `GET /users/...`
- `GET|POST|PUT|DELETE /interactions/...`

## Wireframes

https://gemini.google.com/share/b8811c595e88

## How I Use AI

I use AI primarily as a teacher, reviewer, and pair-programming guide, not as a full autopilot code generator.

### Skills I use

The example prompts for the skills used in this repo live in:

- `example-skills/README.md`
- `example-skills/example.teach-me.md`
- `example-skills/example.quickstart-me.md`
- `example-skills/example.correct-me.md`

### What each skill does for me

- `teach-me`
  - My default mode.
  - Gives me step-by-step implementation guidance with checkpoints.
  - Best for learning while I type the code myself.
- `correct-me`
  - Reviews my existing code and reasoning.
  - Best for catching logic mistakes, edge cases, and small fixable issues after I implement.
- `quickstart-me`
  - Generates beginner-first mini tutorials in Markdown.
  - Best for learning a concept from zero before I touch the real codebase.

### My AI usage philosophy

- Most of the time I am following the `teach-me` skill and implementing the changes myself step by step.
- I only let AI generate and implement code when I completely understand the functionality and feel ready to accelerate development.
- Roughly speaking, about 85% of the time I am learning or implementing with guided mentorship, and about 15% of the time I let AI generate and apply code changes directly.
- Even when AI helps more aggressively, I still verify the behavior myself by running the app, checking the database, and testing features end to end.

## VoteFeed (How Merlin Built It)

**Guy R.:**
Merlin, I want to start with the moment before any of this existed. Before the database tables. Before the endpoints. Before you were staring at an API response at 2 a.m. like it personally betrayed you. What was happening that made you say: "I have to build this"?

**Merlin:**
I was watching people argue online about bills they had not read, from lawmakers they could not name, from a district they were not even sure they lived in. And I kept thinking: politics online is like a group chat where everyone is yelling and nobody has the link.

**Guy R.:**
So you built the link.

**Merlin:**
I built the feed. VoteFeed is basically a Twitter or Bluesky-like experience where constituents can interact with their U.S. House representative by sharing opinions on policies up for vote based on what actually happened. Enter your address, get your district, get your rep, see the voting record, then react: approve, disapprove, comment.

**Guy R.:**
This feels like the most modern way to do civic engagement. It is like, "Here's democracy, but also dopamine."

**Merlin:**
Exactly. I am not proud of that part, but I am also not denying it.

**Guy R.:**
Okay, walk me through the version one promise. If I am a user, what do I get on day one?

**Merlin:**
MVP V1 was: any user can enter an address and see a cascading feed of their district's assigned U.S. representative's voting record. Then users can register and log in. And once you are authorized, you can save your address, district, and rep, approve or disapprove of a bill, and leave a comment about why.

**Guy R.:**
So you built the full loop. Identity to district to representative to voting record to interaction.

**Merlin:**
Yeah. It is the full pipeline from "Where do I live?" to "Here is my opinion, respectfully, and with a timestamp."

**Guy R.:**
Let's talk about the APIs, because whenever someone says "I'm just going to pull public information," I hear ominous music in my head. What did you use?

**Merlin:**
For the congressional district from an address, I used the U.S. Census Geocoder API. Then to get the rep, I used the Congress.gov API member list by state and district. And to get voting data, I used the House vote endpoints, including member-by-member votes.

**Guy R.:**
I love how calm that sounded. Because I know what happened behind the scenes was you getting a response shaped like a nested Russian doll.

**Merlin:**
Yes. The hardest part was not the big pieces. It was the glue. What is the canonical ID for a bill? How do I store vote metadata cleanly? What happens when the API rate-limits me? How do I make the feed feel simple while the backend is doing gymnastics?

**Guy R.:**
Let's get into the database. Because there is something deeply funny about taking heated political opinions and turning them into rows.

**Merlin:**
That is exactly what it is. Democracy, but normalized.

**Guy R.:**
Okay, endpoints. Give me the menu.

**Merlin:**
Auth is: register, login, logout, and "me" to return the current user. Users: get my profile, update my saved defaults like address, district, rep. Lookup: get district from address, get rep from state and district. Bills and votes: bill details, overall House vote metadata, and member-by-member votes. Interactions: create an interaction, list interactions for a bill, and delete your own.

**Guy R.:**
That delete endpoint is emotional maturity. Because sometimes you wake up and you are like, "Why did I disapprove this bill at 1:47 a.m. and leave a comment that starts with 'Listen.'"

**Merlin:**
Exactly. That endpoint exists for personal growth.

**Guy R.:**
So V1 works. Now you are looking at V2. What do you want VoteFeed to become?

**Merlin:**
V2 is where it turns into a true product for the public. Filtering the feed by bill interests, showing how other constituents in your district are voting and commenting, adding more bill info like vote date and bill type, adding rep info like photo and links, third-party login, notifications when there are new votes from your rep, and language moderation so the comments stay appropriate.

**Guy R.:**
That last part is where you realize you did not just build an app. You built a place. And places need rules.

**Merlin:**
Yeah. When people care, they show up loud. And I want it to stay grounded in the bill, not just vibes.

**Guy R.:**
Okay, final question. If you had to describe VoteFeed in one sentence, what is it?

**Merlin:**
VoteFeed is where you stop guessing what your rep did and start responding to what they actually did.

**Guy R.:**
Merlin Valdez, founder of VoteFeed.

Copyright (c) 2025 Merlin Valdez  
All rights reserved.

No permission is granted to use, copy, modify, or distribute this software.
