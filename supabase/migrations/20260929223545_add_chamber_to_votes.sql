-- 1. Add the column (nullable at first)
ALTER TABLE roll_call_summaries ADD COLUMN chamber text;
ALTER TABLE member_voting_record ADD COLUMN chamber text;

-- 2. Backfill existing records (they are all House votes currently)
UPDATE roll_call_summaries SET chamber = 'House' WHERE chamber IS NULL;
UPDATE member_voting_record SET chamber = 'House' WHERE chamber IS NULL;

-- 3. Make the column required
ALTER TABLE roll_call_summaries ALTER COLUMN chamber SET NOT NULL;
ALTER TABLE member_voting_record ALTER COLUMN chamber SET NOT NULL;

-- 4. Drop the old unique indexes
DROP INDEX IF EXISTS idx_roll_call_summaries_session_roll_call;
DROP INDEX IF EXISTS idx_member_voting_record_member_roll_call;

-- 5. Create new unique indexes that include the chamber
CREATE UNIQUE INDEX idx_roll_call_summaries_chamber_session_roll_call
ON roll_call_summaries(chamber, session_number, roll_call_number);

CREATE UNIQUE INDEX idx_member_voting_record_member_chamber_roll_call
ON member_voting_record (member_id, chamber, session_number, roll_call_number);
