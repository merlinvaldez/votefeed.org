import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

const read = async path => stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'));
const source = await read('../supabase/functions/send-vote-notifications/index.ts');
const digest = (await read('../supabase/functions/send-vote-notifications/digest.ts'))
  .replace(/^import .*;\r?$/gm, '').replace(/^export .* from .*;\r?$/gm, '').replaceAll('export function', 'function');
const summary = (await read('../supabase/functions/send-vote-notifications/summary.ts')).replaceAll('export function', 'function');
const enrichment = source.slice(source.indexOf('function enrichVote('), source.indexOf('async function markOutboxRowsProcessed('));
const generation = source.slice(source.indexOf('async function generateMissingAiSummaries('), source.indexOf('function buildPreviewDigest('));

test('AI failure sends nothing; successful retry sends one bill line and acknowledges both events without resending', async () => {
  const common = { member_id:'E000297', chamber:'House', congress_number:119, session_number:2,
    legislation_type:'hres', legislation_number:1650, attempt_count:0 };
  const pending = [
    {...common,id:'older',roll_call_number:318,vote:'Nay',voted_on:'2026-11-10T23:10:00Z'},
    {...common,id:'latest',roll_call_number:319,vote:'No',voted_on:'2026-11-10T23:20:00Z'},
  ];
  const bill = { bill_type:'hres', number:1650, title:'Providing for consideration of a bill', summary:'', aisummary:null };
  const rep = {full_name:'Espaillat, Adriano',chamber:'House of Representatives',state:'New York',congressionaldistrict:13,is_current_member:true};
  let progress = [], handler, failGeneration = true;
  const sent = [], processed = [], failures = [];
  const client = { from() {
    let update;
    const q = { update(value) { update=value; return q; },eq() {return q;},is(){return q;},select(){return q;},
      then(resolve,reject) { Object.assign(bill,update);return Promise.resolve({data:[{id:1}],error:null}).then(resolve,reject); } };
    return q;
  } };
  runInNewContext(`${digest}\n${summary}\n${enrichment}\n${generation}\n${source.slice(source.indexOf('Deno.serve('))}`, {
    console, Request, Response, Date,
    Deno:{env:{get:()=> 'configured'},serve(fn){handler=fn;}},
    createClient:()=>client, json:(value,status=200)=>Response.json(value,{status}),
    isNotificationDateEligible:()=>true,isNotificationSendWindow:()=>false,
    isServiceRoleRequest:()=>true, getErrorMessage:String, isDeliverable:()=>true,
    MAX_AI_SUMMARIES_PER_INVOCATION:25, MAX_EMAILS_PER_INVOCATION:100,
    NOTIFICATION_START_AT:'2026-09-15', SENATE_NOTIFICATION_START_AT:'2026-10-23',
    loadPendingOutboxRows:async()=>pending, findRepsByBioguideIds:async()=>new Map([['E000297',rep]]),
    findBillsForVotes:async()=>new Map([['hres:1650',bill]]), getBillMapKey:()=> 'hres:1650',
    findAllNotificationUsers:async()=>[{id:7,email:'test@example.test',state:'New York',district:13}],
    findProgressForUsers:async()=>progress, markOutboxRowsSkipped:async()=>{},
    generateQuickSummary:async()=> { if(failGeneration) throw new Error('upstream unavailable');return 'allow consideration of a bill'; },
    hasTimeRemaining:()=>true,
    buildDigestEmail:({votes})=>{assert.equal(votes.length,1);assert.equal(votes[0].vote,'No');return {subject:'digest',html:'body',text:'body'};},
    createDigestIdempotencyKey:async(_user,ids)=>[...ids].sort().join(','),
    sendEmail:async(_key,idempotency)=>{sent.push(idempotency);},
    markUserVoteNotificationSent:async(_client,userId,rows)=>{progress=rows.map(p=>({...p,user_id:userId}));},
    markOutboxRowsProcessed:async(_client,rows)=>{processed.push(...rows.map(r=>r.id));},
    markOutboxRowsFailed:async(_client,rows)=>{failures.push(...rows);return {deadLetteredRowCount:0};},
    countPendingOutboxRows:async()=>pending.length,
  });
  const request=mode=>new Request('https://test',{method:'POST',body:JSON.stringify({mode})});
  const blocked=await (await handler(request('send'))).json();
  assert.equal(blocked.sentEmailCount,0);
  assert.equal(blocked.deferredMissingSummaryUserCount,1);
  assert.equal(sent.length,0);assert.equal(progress.length,0);assert.equal(processed.length,0);
  assert.equal(failures.length,0,'missing AI must remain pending, not count as failed delivery');
  failGeneration=false;
  const success=await (await handler(request('send'))).json();
  assert.equal(success.sentEmailCount,1);
  assert.deepEqual(processed.sort(),['latest','older']);
  assert.equal(progress[0].last_notified_roll_call_number,319);
  await handler(request('send'));
  assert.equal(sent.length,1,'retry must not resend after successful progress');
  await handler(request('scheduled'));
  assert.equal(sent.length,1,'scheduled calls outside the morning window do nothing');
});
