
DROP TABLE IF EXISTS comment_useful_votes;
DROP TABLE IF EXISTS bill_comments;
DROP TABLE IF EXISTS interactions;
DROP TABLE IF EXISTS vote_notification_outbox;
DROP TABLE IF EXISTS roll_call_summaries;
DROP TABLE IF EXISTS member_voting_record;
DROP TABLE IF EXISTS bills;
DROP TABLE IF EXISTS reps;
DROP TABLE IF EXISTS users;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users(
    id serial PRIMARY KEY,
    email text UNIQUE,
    clerk_user_id text UNIQUE,
    first_name text,
    last_name text,
    state text,
    district integer,
    notifications_enabled boolean NOT NULL DEFAULT true, 
    last_notified_session_number integer, 
    last_notified_roll_call_number integer
);

CREATE TABLE reps (
    bioguideId text PRIMARY KEY,
    full_name text NOT NULL,
    party text NOT NULL,
    chamber text NOT NULL,
    state text NOT NULL,
    congressionalDistrict integer, 
    image_url text,
    official_website_url text,
    office_phone text
);

CREATE TABLE bills(
    id serial PRIMARY KEY,
    number integer NOT NULL,
    bill_type text, 
    title text NOT NULL,
    summary text NOT NULL,
    aisummary text, 
    policy_area text, 
    legislation_url text 
);

CREATE TABLE roll_call_summaries (
    id serial PRIMARY KEY,
    legislation_number integer,
    legislation_type text,
    session_number integer NOT NULL,
    roll_call_number integer NOT NULL,
    voted_on timestamptz,
    result text NOT NULL,
    yes_count integer NOT NULL DEFAULT 0,
    no_count integer NOT NULL DEFAULT 0,
    not_voting_count integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX idx_roll_call_summaries_session_roll_call
ON roll_call_summaries(session_number, roll_call_number);

CREATE UNIQUE INDEX idx_bills_bill_type_number
ON bills(bill_type, number);

CREATE TABLE member_voting_record (
    id serial PRIMARY KEY,
    legislationNumber integer,
    legislation_type text,
    session_number integer, 
    roll_call_number integer,
    voted_on timestamptz,
    vote text NOT NULL,
    member_id text NOT NULL
);

CREATE UNIQUE INDEX idx_member_voting_record_member_roll_call
ON member_voting_record (member_id, session_number, roll_call_number);

CREATE TABLE vote_notification_outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_run_id uuid NOT NULL,
    member_id text NOT NULL,
    legislation_type text NOT NULL,
    legislation_number integer NOT NULL,
    session_number integer NOT NULL,
    roll_call_number integer NOT NULL,
    voted_on timestamptz,
    vote text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    attempt_count integer NOT NULL DEFAULT 0,
    last_error text
);

CREATE UNIQUE INDEX idx_vote_notification_outbox_sync_member_roll_call
ON vote_notification_outbox(sync_run_id, member_id, session_number, roll_call_number);

CREATE INDEX idx_vote_notification_outbox_pending_lookup
ON vote_notification_outbox(processed_at, created_at, sync_run_id, member_id);


CREATE TABLE interactions (
    id serial PRIMARY KEY,
    stance text NOT NULL,
    user_comment text,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rep_bioguide_id text NOT NULL REFERENCES reps(bioguideId),
    bill_id integer NOT NULL REFERENCES bills(id) ON DELETE CASCADE
);

CREATE TABLE bill_comments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    interaction_id integer NOT NULL UNIQUE REFERENCES interactions(id) ON DELETE CASCADE,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bill_id integer NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    rep_bioguide_id text NOT NULL REFERENCES reps(bioguideId),
    draft_text text,
    approved_text text,
    call_script text,
    message_template text,
    moderation_status text NOT NULL DEFAULT 'draft',
    moderation_reason text,
    moderation_categories jsonb,
    is_public boolean NOT NULL DEFAULT false,
    last_submitted_at timestamptz,
    last_moderated_at timestamptz,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE comment_useful_votes (
    comment_id uuid NOT NULL REFERENCES bill_comments(id) ON DELETE CASCADE,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_comment_useful_votes_comment_user
ON comment_useful_votes(comment_id, user_id);

CREATE INDEX idx_bill_comments_bill_visibility
ON bill_comments(bill_id, is_public, moderation_status, published_at DESC);

CREATE INDEX idx_bill_comments_user_bill
ON bill_comments(user_id, bill_id);

CREATE INDEX idx_interactions_user_rep
ON interactions(user_id,rep_bioguide_id);
