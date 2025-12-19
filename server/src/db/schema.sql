
DROP TABLE IF EXISTS interactions,
DROP TABLE IF EXISTS member_voting_record,
DROP TABLE IF EXISTS bills,
DROP TABLE IF EXISTS reps,
DROP TABLE IF EXISTS users,


CREATE TABLE users(
    id serial PRIMARY KEY,
    email text UNIQUE NOT NULL,
    password text NOT NULL,
    first_name text NOT NULL,
    last_name integer NOT NULL
);

CREATE TABLE reps (
    bioguideId text PRIMARY KEY,
    full_name text NOT NULL,
    district integer NOT NULL
);

CREATE TABLE bills(
    number integer PRIMARY KEY,
    title text NOT NULL,
    summary text NOT NULL
);

CREATE TABLE member_voting_record (
    legislationNumber integer PRIMARY KEY,
    vote text NOT NULL,
    member_id text NOT NULL REFERENCES reps(bioguideId) ON DELETE CASCADE
);


CREATE TABLE interactions (
    id interactions PRIMARY KEY,
    stante text NOT NULL,
    user_comment text,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bill_id integer NOT NULL REFERENCES bills(number) ON DELETE CASCADE
);