// Preflight with `node scripts/migrate-local-elections-to-votefeed-dev.mjs`.
// Additive import with `--apply`; the target must be VoteFeed Dev in server/.env.
// User interactions, user geography evidence, and build-job state stay in Dev.
import pg from '../server/node_modules/pg/lib/index.js';
import dotenv from '../server/node_modules/dotenv/lib/main.js';
import { readFile } from 'node:fs/promises';

const localDatabase = 'votefeed_fec_candidates_2026_local';
const localPort = Number(process.env.VOTEFEED_LOCAL_PG_PORT ?? 5432);
const expectedProjectRef = 'kddqnmenstoilnzwajnb';
const tables = [
  'election_races',
  'election_candidates',
  'election_candidate_identities',
  'election_candidacies',
  'election_ingestion_runs',
  'campaign_sites',
  'campaign_sources',
  'campaign_fetch_attempts',
  'campaign_processing_attempts',
  'campaign_claims',
  'campaign_position_versions',
  'campaign_position_evidence',
  'election_source_documents',
  'election_discovery_attempts',
  'election_discovery_observations',
  'election_observation_resolutions',
];

const local = new pg.Client({
  host: '127.0.0.1', port: localPort, user: 'postgres', database: localDatabase, ssl: false,
});
const env = dotenv.parse(await readFile(new URL('../server/.env', import.meta.url)));
const targetUrl = env.DATABASE_URL;
if (!targetUrl) throw new Error('server/.env does not define DATABASE_URL');
const parsedTarget = new URL(targetUrl);
if (!parsedTarget.username.includes(expectedProjectRef) && !parsedTarget.hostname.includes(expectedProjectRef)) {
  throw new Error('server/.env DATABASE_URL is not the expected VoteFeed Dev project');
}
if (parsedTarget.hostname.includes('ycaldyqnmitdajoguagi')) {
  throw new Error('Refusing to connect to the production project');
}
const target = new pg.Client({ connectionString: targetUrl, ssl: { rejectUnauthorized: false } });

const ident = name => `"${name.replaceAll('"', '""')}"`;
const metadata = async client => {
  const db = await client.query('select current_database() as database, current_user as role');
  const result = {};
  for (const table of tables) {
    const columns = await client.query(
      `select column_name, data_type, udt_name, is_nullable, column_default
       from information_schema.columns where table_schema='public' and table_name=$1
       order by ordinal_position`, [table]);
    const primary = await client.query(
      `select a.attname as column_name
       from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
       where i.indrelid=$1::regclass and i.indisprimary order by array_position(i.indkey,a.attnum)`,
      [`public.${table}`]);
    const count = await client.query(`select count(*)::int as count from public.${ident(table)}`);
    result[table] = {
      count: count.rows[0].count,
      columns: columns.rows,
      primaryKey: primary.rows.map(row => row.column_name),
    };
  }
  return { database: db.rows[0].database, tables: result };
};

try {
  await local.connect();
  await target.connect();
  await Promise.all([local.query("set time zone 'UTC'"), target.query("set time zone 'UTC'")]);
  const localInfo = await metadata(local);
  const targetInfo = await metadata(target);
  const overlaps = {};
  for (const table of tables) {
    const pk = localInfo.tables[table].primaryKey;
    const targetPk = targetInfo.tables[table].primaryKey;
    if (JSON.stringify(pk) !== JSON.stringify(targetPk)) throw new Error(`Primary key differs for ${table}`);
    const lc = localInfo.tables[table].columns;
    const rc = targetInfo.tables[table].columns;
    if (JSON.stringify(lc.map(x => [x.column_name,x.data_type,x.udt_name])) !==
        JSON.stringify(rc.map(x => [x.column_name,x.data_type,x.udt_name]))) {
      throw new Error(`Column schema differs for ${table}`);
    }
    if (!pk.length) throw new Error(`No primary key found for ${table}`);
    const sourceKeys = await local.query(`select ${pk.map(ident).join(',')} from public.${ident(table)}`);
    const targetKeys = await target.query(`select ${pk.map(ident).join(',')} from public.${ident(table)}`);
    const key = row => JSON.stringify(pk.map(column => row[column]));
    const targetSet = new Set(targetKeys.rows.map(key));
    overlaps[table] = {
      sourceRows: localInfo.tables[table].count,
      targetRows: targetInfo.tables[table].count,
      matchingPrimaryKeys: sourceKeys.rows.filter(row => targetSet.has(key(row))).length,
    };
  }
  if (process.argv.includes('--apply')) {
    const transferOrder = [
      'election_races',
      'election_candidates',
      'election_ingestion_runs',
      'election_candidate_identities',
      'election_candidacies',
      'election_source_documents',
      'election_discovery_attempts',
      'election_discovery_observations',
      'election_observation_resolutions',
      'campaign_sites',
      'campaign_sources',
      'campaign_fetch_attempts',
      'campaign_processing_attempts',
      'campaign_claims',
      'campaign_position_versions',
      'campaign_position_evidence',
    ];
    const imported = {};
    await target.query('BEGIN');
    try {
      await target.query("SET LOCAL statement_timeout = '180s'");
      for (const table of transferOrder) {
        if (localInfo.tables[table].count === 0) {
          imported[table] = 0;
          continue;
        }
        console.log(`Copying ${table}: ${localInfo.tables[table].count} source rows`);
        const columns = localInfo.tables[table].columns.map(column => column.column_name);
        const columnTypes = new Map(localInfo.tables[table].columns.map(column => [column.column_name, column.data_type]));
        const pk = localInfo.tables[table].primaryKey;
        const sourceExpressions = columns.map(column => {
          const type = columnTypes.get(column);
          return type.startsWith('timestamp')
            ? `${ident(column)}::text as ${ident(column)}`
            : ident(column);
        });
        const rows = await local.query(`select ${sourceExpressions.join(',')}
          from public.${ident(table)} order by ${pk.map(ident).join(',')}`);
        const maxRowsPerBatch = Math.max(1, Math.floor(60000 / columns.length));
        let inserted = 0;
        for (let start = 0; start < rows.rows.length; start += maxRowsPerBatch) {
          const batch = rows.rows.slice(start, start + maxRowsPerBatch);
          const placeholders = [];
          const values = [];
          for (const row of batch) {
            const valueOffset = values.length;
            placeholders.push(`(${columns.map((column, index) => {
              let value = row[column];
              if (table === 'election_ingestion_runs' && column === 'last_successful_run_id') value = null;
              if (value !== null && columnTypes.get(column) === 'jsonb') value = JSON.stringify(value);
              values.push(value);
                const type = columnTypes.get(column);
                const cast = type === 'timestamp with time zone' ? '::timestamptz'
                  : type === 'timestamp without time zone' ? '::timestamp'
                  : type === 'date' ? '::date'
                  : type === 'time without time zone' ? '::time'
                  : '';
                return `$${valueOffset + index + 1}${cast}`;
            }).join(',')})`);
          }
          const result = await target.query(
            `insert into public.${ident(table)} (${columns.map(ident).join(',')})
             values ${placeholders.join(',')} on conflict do nothing`, values);
          inserted += result.rowCount;
        }
        imported[table] = inserted;
      }
      const successfulRunLinks = await local.query(
        'select id,last_successful_run_id from public.election_ingestion_runs where last_successful_run_id is not null');
      for (const run of successfulRunLinks.rows) {
        await target.query(
          'update public.election_ingestion_runs set last_successful_run_id=$2 where id=$1 and last_successful_run_id is null',
          [run.id, run.last_successful_run_id]);
      }

      for (const table of transferOrder) {
        const pk = localInfo.tables[table].primaryKey;
        const hashRows = async client => (await client.query(
          `select ${pk.map(ident).join(',')}, md5(row_to_json(t)::text) as row_hash
           from public.${ident(table)} t`)).rows;
        const keyOf = row => JSON.stringify(pk.map(column => row[column]));
        const sourceHashes = await hashRows(local);
        const targetHashes = await hashRows(target);
        const targetByKey = new Map(targetHashes.map(row => [keyOf(row), row.row_hash]));
        for (const sourceRow of sourceHashes) {
          if (targetByKey.get(keyOf(sourceRow)) !== sourceRow.row_hash) {
            const mismatchedColumns = [];
            for (const column of localInfo.tables[table].columns.map(item => item.column_name)) {
              const literal = `'${column.replaceAll("'", "''")}'`;
              const columnHashes = async client => (await client.query(
                `select ${pk.map(ident).join(',')},
                 md5(coalesce((to_jsonb(t)->${literal})::text,'null')) as value_hash
                 from public.${ident(table)} t`)).rows;
              const sourceColumnHashes = await columnHashes(local);
              const targetColumnHashes = await columnHashes(target);
              const targetColumnByKey = new Map(targetColumnHashes.map(row => [keyOf(row), row.value_hash]));
              const different = sourceColumnHashes.filter(row => targetColumnByKey.get(keyOf(row)) !== row.value_hash).length;
              if (different) mismatchedColumns.push({ column, differentRows: different });
            }
            console.log(JSON.stringify({ table, mismatchedColumns }));
            throw new Error(`Imported row is missing or differs in ${table}`);
          }
        }
        if (sourceHashes.length) console.log(`Verified ${table}: ${sourceHashes.length} rows`);
      }
      await target.query('COMMIT');
    } catch (error) {
      await target.query('ROLLBACK');
      throw error;
    }
    process.stdout.write(JSON.stringify({
      project: expectedProjectRef,
      localDatabase: localInfo.database,
      targetDatabase: targetInfo.database,
      imported,
      preservedTargetRows: 'Existing rows retained; conflicting rows were not updated.',
    }, null, 2) + '\n');
  } else {
  process.stdout.write(JSON.stringify({
    project: expectedProjectRef,
    localDatabase: localInfo.database,
    targetDatabase: targetInfo.database,
    overlaps,
  }, null, 2) + '\n');
  }
} finally {
  await Promise.allSettled([local.end(), target.end()]);
}
