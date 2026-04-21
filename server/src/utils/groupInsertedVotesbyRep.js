export function groupInsertedVotesByRep(insertedRows = []) {
  const grouped = new Map();

  for (const row of insertedRows) {
    const memberId = String(row?.member_id ?? "").trim();
    if (!memberId) continue;

    const normalizedVote = {
      memberId,
      legislationNumber: row.legislation_number,
      legislationType: row.legislation_type,
      sessionNumber: row.session_number,
      rollCallNumber: row.roll_call_number,
      votedOn: row.voted_on,
      vote: row.vote,
    };
    if (!grouped.has(memberId)) grouped.set(memberId, []);
    grouped.get(memberId).push(normalizedVote);
  }
  return Array.from(grouped, ([memberId, votes]) => ({
    memberId,
    votes: votes.sort((a, b) => {
      if (a.sessionNumber !== b.sessionNumber)
        return b.sessionNumber - a.sessionNumber;
      return b.rollCallNumber - a.rollCallNumber;
    }),
  }));
}
