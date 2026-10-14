import db from "../client.js";

export function postgresFeedSnapshots(runner = db) {
  return {
    async save(snapshot) {
      // Fixed lifetimes; opportunistically reclaim expired rows on new reads.
      await runner.query("DELETE FROM public.legislative_feed_snapshots WHERE expires_at <= NOW()");
      await runner.query(`INSERT INTO public.legislative_feed_snapshots
        (id, signing_key, payload, expires_at) VALUES ($1, $2, $3::jsonb, $4)`,
      [snapshot.id, snapshot.signingKey, JSON.stringify(snapshot.payload), new Date(snapshot.expiresAt)]);
    },
    async get(id) {
      const { rows: [row] } = await runner.query(`SELECT id, signing_key, payload, expires_at
        FROM public.legislative_feed_snapshots WHERE id = $1`, [id]);
      return row ? { id: row.id, signingKey: row.signing_key, payload: row.payload,
        expiresAt: new Date(row.expires_at).getTime() } : null;
    },
  };
}
