import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import db from '../db/client.js';
import {
  claimElectionFeedBuildJob,
  finishElectionFeedBuildJob,
  renewElectionFeedBuildLease,
  updateElectionFeedBuildProgress,
} from '../db/queries/elections.js';
import { RELEASE_SCOPE } from './contracts.js';
import { discoveryScope, safeCode } from './discoveryUtils.js';
import { syncCandidates } from './syncCandidates.js';
import { syncCampaignSiteDiscovery } from './syncCampaignSiteDiscovery.js';
import { syncCampaignPositions } from './syncCampaignPositions.js';

const STAGES = ['candidates','websites','positions'];
const LEASE_MS = 120000;
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));

function scopeFor(job) {
  return discoveryScope({
    ...RELEASE_SCOPE,
    states:[job.state],
    offices:[job.office],
    ...(job.office==='house' ? {district:job.district} : {}),
  });
}

async function runStage(name,scope,job) {
  if (name==='candidates') return syncCandidates({
    scope,
    fecApiKey:process.env.FEC_API_KEY,
    discoverCommittees:false,
    maxPages:100,
    pool:db,
  });
  if (name==='websites') return syncCampaignSiteDiscovery({
    scope,
    maxCandidates:100,
    maxPages:5,
    refresh:false,
    db,
  });
  if (name==='positions') return syncCampaignPositions({scope,maxPages:5,skipPublished:true,db});
  throw new Error('discovery-invalid-worker-stage');
}

export async function processElectionFeedBuildJob(job) {
  const progress={stages:{...job.progress.stages}};
  const errorCodes=new Set(job.errorCodes);
  let leaseLost=false, heartbeatBusy=false;
  const heartbeat=setInterval(async()=>{
    if (heartbeatBusy || leaseLost) return;
    heartbeatBusy=true;
    try { leaseLost=!(await renewElectionFeedBuildLease(job.id,{leaseMs:LEASE_MS},db)); }
    catch { /* next heartbeat may recover; the lease remains bounded */ }
    finally { heartbeatBusy=false; }
  },30000);
  heartbeat.unref?.();
  try {
    const scope=scopeFor(job);
    for (const stage of STAGES) {
      if (progress.stages[stage]==='complete') continue;
      if (leaseLost) return;
      const stageIndex=STAGES.indexOf(stage);
      for (const dependent of STAGES.slice(stageIndex+1)) {
        if (progress.stages[dependent]==='complete') progress.stages[dependent]='pending';
      }
      progress.stages[stage]='running';
      if (!await updateElectionFeedBuildProgress(job.id,progress,db)) return;
      try {
        const result=await runStage(stage,scope,job);
        const status=result?.status;
        progress.stages[stage]=status==='complete' ? 'complete' : status==='failed' ? 'failed' : 'partial';
        for (const code of result?.errorCodes ?? []) if (/^[a-z0-9-]{1,80}$/.test(code)) errorCodes.add(code);
        if (progress.stages[stage]!=='complete' && !result?.errorCodes?.length) errorCodes.add(`build-${stage}-partial`);
      } catch (error) {
        progress.stages[stage]='failed';
        errorCodes.add(safeCode(error));
      }
      if (!await updateElectionFeedBuildProgress(job.id,progress,db)) return;
    }
    if (leaseLost) return;
    const statuses=Object.values(progress.stages);
    const status=statuses.every(value=>value==='complete') ? 'complete'
      : statuses.every(value=>value==='failed') ? 'failed' : 'partial';
    await finishElectionFeedBuildJob(job.id,{status,progress,errorCodes:[...errorCodes]},db);
  } finally {
    clearInterval(heartbeat);
  }
}

export async function runElectionFeedWorker({pollIntervalMs=5000,shouldStop=()=>false}={}) {
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs<250 || pollIntervalMs>60000) throw new TypeError('Invalid election worker poll interval');
  while (!shouldStop()) {
    const job=await claimElectionFeedBuildJob({leaseMs:LEASE_MS},db);
    if (!job) { await sleep(pollIntervalMs); continue; }
    try { await processElectionFeedBuildJob(job); }
    catch (error) { console.error('election_feed_worker_error',safeCode(error)); }
  }
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  let stopping=false;
  process.once('SIGINT',()=>{stopping=true;});
  process.once('SIGTERM',()=>{stopping=true;});
  runElectionFeedWorker({shouldStop:()=>stopping})
    .catch(error=>{console.error('election_feed_worker_stopped',safeCode(error));process.exitCode=1;})
    .finally(()=>db.end());
}
