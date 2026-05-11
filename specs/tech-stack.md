# VoteFeed Tech Stack

Last updated: 2026-05-11

This file captures the current implementation and operational truth for VoteFeed based on the local repo and database schema.

## Architecture Overview

VoteFeed is currently split across three main surfaces:

- a React + Vite client application
- an Express API server
- Supabase-backed background workflows for vote sync and notifications

Deployment is split between Vercel and Supabase:

- the client is deployed as a Vercel SPA
- the server is deployed as a separate Vercel API surface
- Supabase provides Postgres plus Edge Functions used for vote sync and notification delivery

## Frontend

Location:

- `client/`

Primary stack:

- React 19
- Vite 7
- React Router 7
- Clerk React
- MUI 7
- Lucide React
- ApexCharts / React ApexCharts
- Vercel Analytics

Frontend behavior notes:

- API resolution prefers explicit env overrides, then Vercel related-project injection, then `http://localhost:4000`
- guest and authenticated flows both exist, but authenticated flows are the canonical path for saved district and user-specific actions
- the bill page is evolving toward direct representative contact actions

## Backend API

Location:

- `server/`

Primary stack:

- Node.js with ESM modules
- Express 5
- `pg`
- Clerk Express
- Resend
- OpenAI SDK
- `@openai/agents`
- Nodemon for local dev

Mounted API groups:

- `/districts`
- `/reps`
- `/bills`
- `/housevotes`
- `/users`
- `/interactions`

Backend responsibility split:

- route handlers orchestrate upstream fetches and user-facing API behavior
- query modules own Postgres access
- utility modules handle email composition and AI summary generation

## Database

Source of truth:

- `server/src/db/schema.sql`

Important note:

- the README includes useful schema/product framing, but the actual schema file is the canonical database truth

### Core Tables

`users`

- stores VoteFeed users, Clerk identity mapping, district context, and notification cursor state

`reps`

- stores representative identity keyed by `bioguideId`
- currently includes image URL, official website URL, and office phone

`bills`

- stores bill identity keyed by `(bill_type, number)`
- stores title, summary, optional AI summary, policy area, and legislation URL

`member_voting_record`

- stores representative vote history
- canonical uniqueness is per member, session, and roll call

`roll_call_summaries`

- stores overall House roll-call outcomes and counts

`interactions`

- stores VoteFeed-side user stance and optional comment text
- this is application state, not proof of congressional delivery

`vote_notification_outbox`

- stores queued notification work for representative vote updates
- this is an email notification queue, not a constituent messaging pipeline

### Canonical Identity Rules

- representative identity: `reps.bioguideId`
- bill identity: `(bills.bill_type, bills.number)`
- vote identity for sync/idempotency: `(member_id, session_number, roll_call_number)`
- roll-call summary identity: `(session_number, roll_call_number)`

### Important Database Behaviors

- district updates reset user notification cursors
- notification processing advances `last_notified_session_number` and `last_notified_roll_call_number`
- vote notifications use an outbox pattern instead of immediate inline delivery

## External Integrations

### Civic Data

- U.S. Census Geocoder API
  - resolves address -> state + congressional district

- Congress.gov API
  - member list and representative lookup
  - member detail lookups for official website and office phone
  - House vote list
  - House roll-call member votes
  - bill summaries

### Auth

- Clerk
  - frontend auth UI and session handling
  - backend user identity resolution

### Email

- Resend
  - sends representative-vote notification emails to users

### AI

- OpenAI
  - bill-summary simplification / AI summary generation
  - AI output is cached in the `bills.aisummary` field

## Background Jobs And Notifications

Location:

- `supabase/functions/sync-votes`
- `supabase/functions/send-vote-notifications`

### `sync-votes`

Responsibilities:

- fetch new House votes from Congress.gov
- upsert member vote rows
- upsert roll-call summaries
- fetch and upsert bill summaries
- queue summary-ready vote notifications into `vote_notification_outbox`

### `send-vote-notifications`

Responsibilities:

- load pending outbox rows
- group queued rows by sync run and representative
- skip undeliverable representatives safely
- wait for summary-ready bill context
- email users about their representative's latest votes
- advance user notification cursors
- dead-letter repeated failures after bounded retry attempts

Implementation rule:

- notification delivery is intentionally gated on usable bill summary context

## Deployment Topology

### Client

File:

- `client/vercel.json`

Behavior:

- rewrites all routes to `/index.html`
- uses Vercel related-project support for API host resolution

### Server

File:

- `server/vercel.json`

Behavior:

- rewrites all requests to `/api/index.js`
- adds permissive CORS headers at the Vercel layer

### Supabase

File:

- `supabase/config.toml`

Behavior:

- local Postgres + Studio + Edge Runtime config
- edge functions `sync-votes` and `send-vote-notifications` are enabled
- local auth, storage, realtime, and inbucket services are configured

Repo note:

- the README currently points production function deployments at Supabase project ref `ycaldyqnmitdajoguagi`

## Configuration Surfaces

### Server Example Env

From `server/example.env`:

- `PORT`
- `CONGRESS_API_KEY`
- `DATABASE_URL`
- `NODE_ENV`
- `JWT_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `APP_ORIGIN`

### Supabase Function Secrets

Current function code expects:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CONGRESS_API_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `APP_ORIGIN`

### Frontend Env Behavior

Current frontend API-base resolution uses:

- `VITE_API_URL`
- `VITE_API_BASE`
- `VITE_RELATED_API_URL`

## Local Development

Root command:

- `npm run dev`

What it does:

- runs the Express server and Vite client concurrently

Common server scripts:

- `npm --prefix server run dev`
- `npm --prefix server run db:schema`
- `npm --prefix server run db:seed`
- `npm --prefix server run db:reset`
- `npm --prefix server run db:sync-votes`
- `npm --prefix server run db:sync-bills`
- `npm --prefix server run db:backfill-roll-call-summaries`

Supabase workflow note:

- local repo guidance expects `npx supabase ...` command shapes

## Current Constraints And Gaps

- the README still contains some legacy product framing and older schema language
- there is no meaningful automated test suite configured yet
- comments still exist in the schema and parts of the product, even though the current action direction is shifting toward direct representative contact
- contact-form derivation currently depends on representative website patterns and still needs stronger trust/refresh rules
- the schedule and production invocation wiring for background jobs are operational concerns, not fully represented as first-class code config in this repo

## Stack Change Rule

Update this file when a change affects:

- architecture
- vendors or external services
- schema or canonical identifiers
- deployment topology
- secrets and config surfaces
- background job design

If a change affects product meaning instead of implementation truth, update `mission.md` first.
