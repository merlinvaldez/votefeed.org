# Elections production database acceptance

**Status: not accepted.** Read-only Supabase inspection on 2026-10-28 found that neither the production nor development database has the Elections migrations deployed. No production changes were made.

## Verified state

| Environment | Supabase project | Database | Elections migrations | Expected tables |
|---|---|---|---|---:|
| Production | `votefeed.org` (`ycaldyqnmitdajoguagi`) | PostgreSQL 17 | Neither applied | 0 of 18 present |
| Development | `votefeed-dev` (`kddqnmenstoilnzwajnb`) | PostgreSQL 17 | Neither applied | 0 of 18 present |

The missing versions are `20261026194547_elections_storage` and `20261026203305_election_discovery_observations`. The first creates 14 tables and the second creates 4. Both migration loops enable RLS, revoke all table privileges from `PUBLIC`, `anon`, `authenticated`, and `service_role`, then grant only the privileges each worker needs. The first grants DML to `service_role`; the second grants only `SELECT` and `INSERT`.

Production's default ACLs give `anon` and `authenticated` table privileges, including DML, on public tables owned by `postgres` and `supabase_admin`. The migration revokes those defaults on each Elections table, but this has not been exercised on the deployed schema. The Supabase SQL inspection ran as `postgres`; it did not establish the role used by the Vercel backend's `DATABASE_URL`.

The remote migration ledgers differ. Production has `20261022171033` and `20261022171058`, which Development lacks. Development has early migration versions absent from Production, while Production has `20260915161114`, which is absent from the current local migration directory. Reconcile each environment's history before applying migrations; do not use an unrestricted `supabase db push` to resolve the difference.

## Acceptance checklist

- [x] Identify the connected production and development Supabase projects.
- [x] Read both remote migration ledgers and check all 18 Elections tables in both databases.
- [x] Inspect production public-table default ACLs and compare them with the local migration's per-table RLS and revoke rules.
- [x] Revoke inherited `service_role` defaults before the Elections migrations grant their intended table privileges; the disposable PostgreSQL suite passed with broad Supabase-like default ACLs enabled.
- [ ] Reconcile the repository, Development, and Production migration histories. Record which existing versions represent prior deployments before applying anything.
- [ ] Review the release candidate and confirm the intended migration order: `20261026194547_elections_storage`, then `20261026203305_election_discovery_observations`.
- [ ] Apply the approved migrations through the controlled Supabase migration workflow, Development first and Production afterward. Keep this step separate from any candidate import or scheduled job activation.
- [ ] Confirm both migration versions appear in each intended remote ledger and all 18 tables exist.
- [ ] For every Elections table, verify RLS is enabled, `anon` and `authenticated` lack table privileges, and `service_role` has only the privileges specified by the owning migration.
- [ ] Run the privilege check using the actual Vercel backend database connection role, without exposing or copying the `DATABASE_URL` value. Confirm the role can perform the server operations the API requires.
- [ ] Save the migration and privilege query results, then mark the corresponding item in [elections-backend.md](elections-backend.md) complete.

## Read-only verification SQL

Run these after the migration rollout in the Supabase SQL Editor. The migration query verifies ledger entries. The privilege query returns one row for each Elections table and uses table OIDs so missing relations do not need to be guessed.

```sql
SELECT version, name
FROM supabase_migrations.schema_migrations
WHERE version IN ('20261026194547', '20261026203305')
ORDER BY version;
```

```sql
WITH expected(name, service_write) AS (
  VALUES
    ('election_candidates', true),
    ('election_candidate_identities', true),
    ('election_races', true),
    ('election_candidacies', true),
    ('campaign_sites', true),
    ('campaign_sources', true),
    ('campaign_fetch_attempts', true),
    ('election_ingestion_runs', true),
    ('campaign_processing_attempts', true),
    ('campaign_claims', true),
    ('campaign_position_versions', true),
    ('campaign_position_evidence', true),
    ('election_interactions', true),
    ('election_geography_evidence', true),
    ('election_source_documents', false),
    ('election_discovery_attempts', false),
    ('election_discovery_observations', false),
    ('election_observation_resolutions', false)
)
SELECT e.name,
       c.oid IS NOT NULL AS table_exists,
       c.relrowsecurity AS rls_enabled,
       CASE WHEN c.oid IS NULL THEN NULL ELSE (
         has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT')
         OR has_table_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE')
         OR has_table_privilege('anon', c.oid, 'TRUNCATE') OR has_table_privilege('anon', c.oid, 'REFERENCES')
         OR has_table_privilege('anon', c.oid, 'TRIGGER') OR has_table_privilege('anon', c.oid, 'MAINTAIN')
       ) END AS anon_has_any_table_privilege,
       CASE WHEN c.oid IS NULL THEN NULL ELSE (
         has_table_privilege('authenticated', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'INSERT')
         OR has_table_privilege('authenticated', c.oid, 'UPDATE') OR has_table_privilege('authenticated', c.oid, 'DELETE')
         OR has_table_privilege('authenticated', c.oid, 'TRUNCATE') OR has_table_privilege('authenticated', c.oid, 'REFERENCES')
         OR has_table_privilege('authenticated', c.oid, 'TRIGGER') OR has_table_privilege('authenticated', c.oid, 'MAINTAIN')
       ) END AS authenticated_has_any_table_privilege,
       e.service_write AS service_write_expected,
       CASE WHEN c.oid IS NULL THEN NULL ELSE has_table_privilege('service_role', c.oid, 'SELECT') END AS service_select,
       CASE WHEN c.oid IS NULL THEN NULL ELSE has_table_privilege('service_role', c.oid, 'INSERT') END AS service_insert,
       CASE WHEN c.oid IS NULL THEN NULL ELSE has_table_privilege('service_role', c.oid, 'UPDATE') END AS service_update,
       CASE WHEN c.oid IS NULL THEN NULL ELSE has_table_privilege('service_role', c.oid, 'DELETE') END AS service_delete,
       CASE WHEN c.oid IS NULL THEN NULL ELSE has_table_privilege('service_role', c.oid, 'TRUNCATE') END AS service_truncate,
       CASE WHEN c.oid IS NULL THEN NULL ELSE has_table_privilege('service_role', c.oid, 'REFERENCES') END AS service_references,
       CASE WHEN c.oid IS NULL THEN NULL ELSE has_table_privilege('service_role', c.oid, 'TRIGGER') END AS service_trigger,
       CASE WHEN c.oid IS NULL THEN NULL ELSE has_table_privilege('service_role', c.oid, 'MAINTAIN') END AS service_maintain
FROM expected e
LEFT JOIN pg_class c ON c.relname=e.name AND c.relkind IN ('r','p')
LEFT JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
WHERE c.oid IS NULL OR n.oid IS NOT NULL
ORDER BY e.name;
```

All 18 `table_exists` and `rls_enabled` values should be true. Both browser-role privilege columns should be false. `service_select` and `service_insert` should be true on all tables. `service_update` and `service_delete` should match `service_write_expected`; the four discovery tables should also have false `service_truncate`, `service_references`, `service_trigger`, and `service_maintain` values.
