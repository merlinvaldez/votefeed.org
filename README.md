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
  | Column     | Type    | constraints |
  | ---------- | ------- | ----------- |
  | id         | serial  | PRIMARY KEY |
  | password   | text    | NN          |
  | email      | text    | Unique NN   |
  | first_name | text    | NN          |
  | last_name  | text    | NN          |
  | district   | integer | NN          |
- reps
  | Column           | Type | constraints |
  | ---------------- | ---- | ----------- |
  | **`bioguideId`** | text | PRIMARY KEY |
  | name             | text | NN          |
  | district         | int  | NN          |
- bills
  | Column                  | Type | constraints |
  | ----------------------- | ---- | ----------- |
  | **`legislationNumber`** | int  | PRIMARY Key |
  | bill_code               | text | NN          |
  | bill_name               | text | NN          |
  | session                 | int  | NN          |
  | vote_number             | int  | NN          |
  | summary                 | text | NN          |
- member_voting_record
  | Column                  | Type | constraints                 |
  | ----------------------- | ---- | --------------------------- |
  | **`legislationNumber`** | int  | PRIMARY Key                 |
  | member_id               | FK   | FK → reps(**`bioguideId`**) |
  | vote                    | text | NN                          |
- interactions
  | Column       | Type | constraints                             |
  | ------------ | ---- | --------------------------------------- |
  | id           | int  | PRIMARY Key                             |
  | stance       | text | NN                                      |
  | user_comment | text | NULLANBLE                               |
  | user_id      | FK   | NN, FK → users(id)                      |
  | bill_id      | FK   | NN, FK → bills(**`legislationNumber`**) |

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

Copyright (c) 2025 Merlin Valdez
All rights reserved.

No permission is granted to use, copy, modify, or distribute this software.
