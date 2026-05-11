# VoteFeed Roadmap

Last updated: 2026-05-11

This roadmap is based first on the original VoteFeed.org Notion page.

That matters because I do not want this file to drift into a generic product plan that loses the shape of the product I actually set out to build. When the current repo or newer Notion stories have moved beyond that page, I call that out directly instead of silently rewriting the intent.

## 30 Second Pitch

VoteFeed is a feed-style civic product that helps constituents see what their representatives actually did and respond in context.

The original product framing on the VoteFeed.org page is House-centered. That is still the current implementation focus. The broader mission is bigger than that, but this roadmap keeps the original product ladder intact and then shows how I am extending it.

## MVP V1 Features (FSA Release)

This is the first complete loop I wanted to prove.

### 1. Any user can enter an address and see a cascading feed of their district's assigned U.S. representative's voting record

Status: largely in place

What this includes:

- determine congressional district from an address
- identify the U.S. House representative serving that district
- pull House vote data
- show that representative's voting record in feed form

Current build reality:

- district lookup exists
- representative lookup exists
- vote feed exists
- bill pages and vote detail are stronger now than the original page described

### 2. Users can register and log in

Status: in place

What this includes:

- account creation
- sign in
- authenticated user experience

Current build reality:

- the current auth direction is Clerk-based, not the older hand-rolled auth shape described on the source page
- the public landing and auth conversion flow have already been improved beyond the original V1 wording

### 3. With an authorized account, the user can save context and react to bills

Status: in place, but evolving

What this includes:

- save address
- save district
- save assigned U.S. House representative
- approve or disapprove of a bill
- leave a comment on that bill

Current build reality:

- saved user district context is in place
- stance capture is in place
- comment behavior still exists in the schema and product
- this is also the part of the product that is changing the most, because I no longer think public comments are the strongest center of the experience

## MVP V2 Features (Public Release)

This is where the original VoteFeed.org page starts becoming a fuller public product.

Some of these items are already built or partially built. Some are still active roadmap work. A few now need updated interpretation.

### 1. Organize the feed based on bill interests

Status: largely in place

This was one of the clearest V2 upgrades on the source page, and it is now one of the clearest examples of the product maturing in the repo.

### 2. Show how other constituents in the district are voting and commenting on bills

Status: still open

This remains part of the original public-release vision, but it needs to be handled carefully. I do not want VoteFeed to become another noisy political comment product just because this feature exists on the early roadmap.

The real question here is not whether people can see each other. The real question is whether that makes the constituent-to-representative relationship clearer and more useful.

### 3. Show richer bill and representative information

Status: partially in place

Original source direction:

- vote date
- bill type
- bill contents
- representative photo
- representative page link

Current build reality:

- vote dates and vote results are already much better surfaced now
- bill and representative detail have already been strengthened
- representative metadata has expanded beyond the original page, including contact-oriented fields now stored in the product

### 4. Add third-party login and signup

Status: in place

This started as a V2 item on the source page and is now part of the current implementation direction through Clerk.

### 5. Help authorized users contact their representative

Status: in progress, with an important interpretation change

Original source page wording:

- authorized users' comments are sent directly to the representative's email address

Current product direction:

- I am not treating this as "VoteFeed sends the message for you"
- I am treating this as "VoteFeed helps you contact your representative directly and clearly"

That means the near-term product is:

- choose or confirm a stance on a bill
- show the representative's phone number, official website, and contact path
- generate a bill-specific call script
- generate a bill-specific contact form draft
- make it clear that the user is the one contacting the office through official channels

This is the biggest roadmap reinterpretation in the file, and I want it stated plainly because it reflects the current Notion work.

### 6. Moderate comment language

Status: still open

This remains relevant as long as comments remain part of the product. If the direct-contact workflow becomes the stronger center of the bill page, moderation still matters, but it may stop being one of the highest-leverage product bets.

### 7. Show how closely the user aligns with their representative

Status: partially in place

This started as a V2 idea and now has real implementation movement behind it. It still needs refinement to become a polished, stable, user-facing product capability rather than just a supporting metric.

### 8. Notify users when their representative casts new votes

Status: largely in place

This was a clear V2 public-release feature on the source page and is now one of the strongest examples of the roadmap turning into actual system behavior.

## Stretch Features

These are still useful, but I do not want them to distract from finishing the core product well.

### 1. Let authorized users interact with bills before they are voted on

Still a stretch feature.

This would move VoteFeed from reacting to legislative history into engaging with the live legislative agenda.

### 2. Show an upcoming legislative agenda feed

Still a stretch feature.

This is one of the most important long-term opportunities in the product because it changes VoteFeed from "what happened" into "what is happening and what can I do now?"

### 3. Link out to external bill documents

Partially in motion.

The product already has stronger bill-context work than it did early on, but this is still a good example of a stretch feature that deepens trust without changing the product's identity.

### 4. Generate AI pro/con bill breakdowns

Still a stretch feature.

AI explanation can be useful here, but only if it stays grounded in trustworthy source material and does not pretend to be the official record.

### 5. Use AI to help draft messages to representatives

Still a stretch feature.

This fits the direct-contact vision well, but only after the non-AI action flow is strong and trustworthy first.

### 6. Let users click into terms and ask "what's this?"

Still a stretch feature.

I still like this because it supports civic clarity without changing the center of the product.

### 7. Keep comments directed to the bill in question

Still a stretch feature, but possibly less central than it once was.

If comments stop being the heart of the bill page, this becomes less of a flagship roadmap item and more of a safeguard for any remaining comment surface.

## What Is Actually Next

If I compress the original VoteFeed.org page into the clearest next sequence, it looks like this:

1. Finish the strongest version of the current House-based product loop.
2. Complete the direct representative contact workflow in a way that is honest and trustworthy.
3. Keep improving bill and representative context so users can act with more confidence.
4. Decide how much district-level social visibility should exist without turning the product into noise.
5. Expand from the House foundation into the broader representation mission over time.

## Roadmap Reading Rule

When this file and the current backlog diverge, read them this way:

- this roadmap holds the product ladder from the original VoteFeed.org page
- the active backlog explains how I am implementing or reinterpreting parts of that ladder right now

That is especially true for the old "send comments directly to representatives" idea, which is now being rebuilt as a cleaner direct-contact workflow instead of a fake delivery promise.
