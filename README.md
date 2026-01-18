# voteFeed

# 30 Second Pitch

VoteFeed is a twitter/bluesky-like user experience that allows constituents to interact with their respective US. Rep in congress by sharing their opinion on policies up for vote in the legislative agenda.

# MVP V1 Features (FSA Release)

- Any user will be able to enter an address and see a cascading feed of that districts assigned US Rep’s voting record ✅
  - Reqs
    - Ability to determine congressional district from an address
      - [U.S. Census Geocoder API](https://geocoding.geo.census.gov/geocoder/)
        - Get Request serving congressional district based on address
    - Ability to get US rep serving that district
      - Get request to https://api.congress.gov/#/member/member_list_by_state_and_district
    - Ability to get the voting record of US house member
      - Get request to get all the votes [https://api.congress.gov/#/[BETA]\_house-vote/house_vote_list](https://api.congress.gov/#/%5BBETA%5D_house-vote/house_vote_list)
      - Get request to get the voting record of the us rep for that specific bill [https://api.congress.gov/#/[BETA]\_house-vote/house_vote_members](https://api.congress.gov/#/%5BBETA%5D_house-vote/house_vote_members)
- Users will be able to register and log in ✅
  - Post request to register
  - Post request to log in
  - user auth logic
- With an authorized account, the user will be able to: ✅
  - Save their address/ district/ US house rep ✅
    - post request to users table ✅
  - Approve or disapprove of a bill ✅
    - post request to add approve or disapprove
  - Leave a comment regarding their approval/disapproval of said bill ✅
    - post request to write comment on interactions table

# MVP V2 Features (Public Release)

- Ability for any user to organize their feed based on their bill interests (Filtering)
- Ability for any user to see how other fellow constituents in their districts are voting and commenting on bills
- Ability for any users to access more relevant information about their bills and representatives such as:
  - About their bills
    - When it was voted on
    - Access to bill contents
    - The type of bill that it is
      - Bill
      - Joint Resolution
      - Concurrent Resolutions
      - Simple Resolutions
  - About their representatives
    - Photo
    - Link to their Page
- Ability for any user to log in/sign up using third party accounts
- Authorized users’ comments are sent directly to the representatives email address.
- As a user, I only want to see comments that is appropriate in language
- As I user, I want to see how I align with my representatives
- As a user I want to be notified on new votes from my reps

# Stretch Features

- Ability for authorized users to do the following for bills that have not yet been voted on.
  - Approve or disapprove of a bill
  - Leave a comment regarding their approval/disapproval of said bill
- Ability for any user to see the a cascading agenda of bills that will be voted on soon
- Authorized users are able to access the external documents of the bill
- Authorized users are able to get a pro/con AI breakdown of the bill (based on the news)
- Authorized users are able to use AI to redact comments to their representatives
- Any user is able to click on parts of the site and ask “what’s this?” to help them understand key definitions
- As a user I only want to see comments that are directed to the bill in question

# Project Management System

[VoteFeed Dev](https://www.notion.so/VoteFeed-Dev-2c7155d4c85080bebe06d6905a3a50cf?pvs=21)

# Db Schema

- users
  | Column | Type | constraints |
  | ---------- | ------- | ----------- |
  | id | serial | PRIMARY KEY |
  | password | text | NN |
  | email | text | Unique NN |
  | first_name | text | NN |
  | last_name | text | NN |
  | district | integer | NN |
- reps
  | Column | Type | constraints |
  | ---------------- | ---- | ----------- |
  | **`bioguideId`** | text | PRIMARY KEY |
  | name | text | NN |
  | district | int | NN |
- bills
  | Column | Type | constraints |
  | ----------------------- | ---- | ----------- |
  | **`legislationNumber`** | int | PRIMARY Key |
  | bill_code | text | NN |
  | bill_name | text | NN |
  | session | int | NN |
  | vote_number | int | NN |
  | summary | text | NN |
- member_voting_record
  | Column | Type | constraints |
  | ----------------------- | ---- | --------------------------- |
  | **`legislationNumber`** | int | PRIMARY Key |
  | member_id | FK | FK → reps(**`bioguideId`**) |
  | vote | text | NN |
- interactions
  | Column | Type | constraints |
  | ------------ | ---- | --------------------------------------- |
  | id | int | PRIMARY Key |
  | stance | text | NN |
  | user_comment | text | NULLANBLE |
  | user_id | FK | NN, FK → users(id) |
  | bill_id | FK | NN, FK → bills(**`legislationNumber`**) |

# API endpoints

# Auth

- **POST** `/auth/register` – create account
- **POST** `/auth/login` – get JWT/session
- **POST**`/auth/logout` – destroy session
- **GET** `/auth/me` – return current user profile

# Users (profile & saved defaults)

- **GET** `/users/me` – fetch profile (email, name, district, rep)
- **PUT** `/users/me` – update profile fields (e.g., `address`, `district`, `repId`)

# District & Rep lookup

- **GET** `/api/lookup/district?address=...` – resolve address → congressional district
- **GET** `/api/lookup/rep?state=NY&district=7` – fetch the US House member for a district

# Bills & Votes (feed + details)

- **GET** `/api/bills/:legislationNumber` – bill detail (summary, session, vote_number)
- **GET** `/api/bills/:legislationNumber/house-vote` – overall House vote metadata (roll call)
- **GET** `/api/bills/:legislationNumber/house-vote/members` – member-by-member votes

# Constituent interactions (approve/disapprove + comments)

- **POST** `/api/interactions` – create interaction `{ bill_id, stance: 'approve'|'disapprove', user_comment? }`
- **GET** `/api/interactions?bill_id=123` – list interactions for a bill
- **GET** `/api/bills/:legislationNumber/` – summary + recent comments for that bill (district-level aggregates optional)
- **DELETE** `/api/interactions/:id` – remove own interaction

# Wireframes

https://gemini.google.com/share/b8811c595e88

**VoteFeed (How Merlin Built It)**

**Guy R.:**
Merlin, I want to start with the moment before any of this existed. Before the database tables. Before the endpoints. Before you were staring at an API response at 2 a.m. like it personally betrayed you. What was happening that made you say: “I have to build this”?

**Merlin:**
I was watching people argue online about bills… that they hadn’t read… from lawmakers they couldn’t name… from a district they weren’t even sure they lived in. And I kept thinking, politics online is like a group chat where everyone is yelling and nobody has the link.

**Guy R.:**
So you built… the link.

**Merlin:**
I built the feed. VoteFeed is basically a Twitter or Bluesky-like experience where constituents can interact with their U.S. House Rep by sharing opinions on policies up for vote—based on what actually happened. Enter your address, get your district, get your rep, see the voting record, then react: approve, disapprove, comment.

**Guy R.:**
This feels like the most modern way to do civic engagement. It’s like, “Here’s democracy… but also… dopamine.”

**Merlin:**
Exactly. I’m not proud of that part, but I’m also not denying it.

**Guy R.:**
Okay, walk me through the version one promise. If I’m a user, what do I get on day one?

**Merlin:**
MVP V1 was: any user can enter an address and see a cascading feed of their district’s assigned U.S. rep’s voting record. Then users can register and log in. And once you’re authorized, you can save your address, district, and rep, approve or disapprove of a bill, and leave a comment about why.

**Guy R.:**
So you built the full loop. Identity to district to representative to voting record to interaction.

**Merlin:**
Yeah. It’s the full pipeline from “Where do I live?” to “Here is my opinion, respectfully, and with a timestamp.”

**Guy R.:**
Let’s talk about the APIs, because whenever someone says “I’m just going to pull public information,” I hear ominous music in my head. What did you use?

**Merlin:**
For the congressional district from an address, I used the U.S. Census Geocoder API. Then to get the rep, I used the Congress.gov API member list by state and district. And to get voting data, I used the House vote endpoints, including member-by-member votes.

**Guy R.:**
I love how calm that sounded. Because I know what happened behind the scenes was you getting a response shaped like a nested Russian doll.

**Merlin:**
Yes. The hardest part wasn’t the big pieces. It was the glue. What’s the canonical ID for a bill? How do I store vote metadata cleanly? What happens when the API rate-limits me? How do I make the feed feel simple while the backend is doing gymnastics?

**Guy R.:**
Let’s get into the database. Because there’s something deeply funny about taking heated political opinions and turning them into… rows.

**Merlin:**
That’s exactly what it is. Democracy, but normalized.

So I have users—email, password, name, district.
Reps—bioguideId as the primary key, name, district.
Bills—legislationNumber as the primary key, bill code, bill name, session, vote number, summary.
Member voting record—legislationNumber plus member_id which references the rep, and their vote.
And then interactions—that’s where the human stuff goes: stance (approve or disapprove), optional comment, user_id linked to users, bill_id linked to bills.

**Guy R.:**
So “interactions” is basically your comment section, but with structure.

**Merlin:**
Yes. A comment section with relational integrity. A very rare species.

**Guy R.:**
Okay, endpoints. Give me the menu.

**Merlin:**
Auth is: register, login, logout, and “me” to return the current user.
Users: get my profile, update my saved defaults like address, district, rep.
Lookup: get district from address, get rep from state and district.
Bills and votes: bill details, overall House vote metadata, and member-by-member votes.
Interactions: create an interaction, list interactions for a bill, and delete your own.

**Guy R.:**
That delete endpoint is emotional maturity. Because sometimes you wake up and you’re like… “Why did I disapprove this bill at 1:47 a.m. and leave a comment that starts with ‘Listen.’”

**Merlin:**
Exactly. That endpoint exists for personal growth.

**Guy R.:**
So V1 works. Now you’re looking at V2. What do you want VoteFeed to become?

**Merlin:**
V2 is where it turns into a true product for the public. Filtering the feed by bill interests, showing how other constituents in your district are voting and commenting, adding more bill info like vote date and bill contents and bill type, adding rep info like photo and links. Third-party login. Notifications when there are new votes from your rep. And I want language moderation so the comments stay appropriate.

**Guy R.:**
That last part is where you realize you didn’t just build an app. You built a place. And places need rules.

**Merlin:**
Yeah. When people care, they show up loud. And I want it to stay grounded in the bill. Not just vibes.

**Guy R.:**
Okay, final question. If you had to describe VoteFeed in one sentence, what is it?

**Merlin:**
VoteFeed is where you stop guessing what your rep did—and start responding to what they actually did.

**Guy R.:**
Merlin Valdez, founder of VoteFeed.

Copyright (c) 2025 Merlin Valdez
All rights reserved.

No permission is granted to use, copy, modify, or distribute this software.
