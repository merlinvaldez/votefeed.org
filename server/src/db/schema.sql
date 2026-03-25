
DROP TABLE IF EXISTS interactions;
DROP TABLE IF EXISTS member_voting_record;
DROP TABLE IF EXISTS bills;
DROP TABLE IF EXISTS reps;
DROP TABLE IF EXISTS users;


CREATE TABLE users(
    id serial PRIMARY KEY,
    email text UNIQUE,
    clerk_user_id text UNIQUE,
    first_name text,
    last_name text,
    state text,
    district integer,
);

CREATE TABLE reps (
    bioguideId text PRIMARY KEY,
    full_name text NOT NULL,
    party text NOT NULL,
    chamber text NOT NULL,
    state text NOT NULL,
    congressionalDistrict integer, 
    image_url text, 
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

CREATE INDEX idx_member_voting_record_member_roll_call
ON member_voting_record (member_id, session_number, roll_call_number);


CREATE TABLE interactions (
    id serial PRIMARY KEY,
    stance text NOT NULL,
    user_comment text,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rep_bioguide_id text NOT NULL REFERENCES reps(bioguideId),
    bill_id integer NOT NULL REFERENCES bills(id) ON DELETE CASCADE
);

CREATE INDEX idx_interactions_user_rep
ON interactions(user_id,rep_bioguide_id);
