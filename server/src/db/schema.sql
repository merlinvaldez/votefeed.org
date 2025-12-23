
DROP TABLE IF EXISTS interactions;
DROP TABLE IF EXISTS member_voting_record;
DROP TABLE IF EXISTS bills;
DROP TABLE IF EXISTS reps;
DROP TABLE IF EXISTS users;


CREATE TABLE users(
    id serial PRIMARY KEY,
    email text UNIQUE NOT NULL,
    password text NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    district integer NOT NULL
);

CREATE TABLE reps (
    bioguideId text PRIMARY KEY,
    full_name text NOT NULL,
    party text NOT NULL,
    chamber text NOT NULL,
    state text NOT NULL,
    congressionalDistrict integer 
);

CREATE TABLE bills(
    id serial PRIMARY KEY,
    number integer NOT NULL,
    title text NOT NULL,
    summary text NOT NULL
);

CREATE TABLE member_voting_record (
    id serial PRIMARY KEY,
    legislationNumber integer,
    vote text NOT NULL,
    member_id text NOT NULL
);


CREATE TABLE interactions (
    id serial PRIMARY KEY,
    stante text NOT NULL,
    user_comment text,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bill_id integer NOT NULL REFERENCES bills(number) ON DELETE CASCADE
);