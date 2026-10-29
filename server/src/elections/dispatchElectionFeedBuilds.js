import { waitUntil as vercelWaitUntil } from '@vercel/functions';
import db from '../db/client.js';
import { claimElectionFeedBuildJob } from '../db/queries/elections.js';
import { safeCode } from './discoveryUtils.js';

const LEASE_MS = 120000;

function isDispatchable(job, now) {
  if (job?.status === 'queued') return true;
  if (job?.status !== 'running' || !job.leaseExpiresAt) return false;
  const leaseExpiresAt = new Date(job.leaseExpiresAt).getTime();
  return Number.isFinite(leaseExpiresAt) && leaseExpiresAt <= now;
}

/**
 * Start one geography job per Vercel background task. The database
 * lease makes duplicate request-triggered dispatches safe and allows a later
 * status poll to reclaim a job after a function timeout.
 */
export function dispatchElectionFeedBuilds(jobs, options = {}) {
  const vercelRuntime = options.vercelRuntime
    ?? (process.env.VERCEL === '1' && ['development', 'preview'].includes(process.env.VERCEL_ENV));
  const inlineEnabled = options.inlineEnabled
    ?? process.env.ELECTIONS_BUILD_DISPATCH === 'true';
  if (!vercelRuntime && !inlineEnabled) return [];

  const schedule = options.schedule
    ?? (vercelRuntime ? vercelWaitUntil : promise => { void promise; });
  const claim = options.claim ?? claimElectionFeedBuildJob;
  const processJob = options.processJob ?? (async job => {
    const { processElectionFeedBuildJob } = await import('./worker.js');
    await processElectionFeedBuildJob(job);
  });
  const runner = options.runner ?? db;
  const now = options.now ?? Date.now();
  const dispatched = [];

  for (const job of jobs ?? []) {
    if (!job?.id || !isDispatchable(job, now)) continue;
    const task = (async () => {
      const claimed = await claim({ jobId: job.id, leaseMs: LEASE_MS }, runner);
      if (claimed) await processJob(claimed);
    })().catch(error => {
      console.error('election_feed_dispatch_error', { jobId: job.id, code: safeCode(error) });
    });

    try {
      schedule(task);
      dispatched.push(job.id);
    } catch (error) {
      console.error('election_feed_dispatch_schedule_error', { jobId: job.id, code: safeCode(error) });
    }
  }
  return dispatched;
}
