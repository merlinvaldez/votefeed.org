import { readFile, writeFile, rename, mkdir, open, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { discoveryError, safeCode, sha256, stableJson, publicUrl } from './discoveryUtils.js';
import { validateSource, documentText, extractWyoming, extractMappedCsv, validateBallotRows } from './ballotExtraction.js';
import { fetchPublic } from './publicHttp.js';

// A checkpoint owns one explicit scope/model. Proposals never become trusted
// descriptors simply because a search finished successfully.
export async function searchSourceCatalog({scope,inventory,provider,checkpoint,resume=false,concurrency=1,onProgress=()=>{}}) {
  if (!checkpoint) throw discoveryError('discovery-checkpoint-required');
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>3) throw discoveryError('discovery-invalid-concurrency');
  await mkdir(dirname(checkpoint),{recursive:true});
  let lock;
  try { lock = await open(`${checkpoint}.lock`,'wx'); }
  catch { throw discoveryError('discovery-checkpoint-locked'); }
  try {
    const signature = sha256(stableJson({scope,model:provider.model,authorities:scope.states.map(state=>({state,
      url:inventory.states.find(s=>s.state===state)?.authorityDirectoryUrl}))}));
    let catalog;
    if (resume) {
      catalog = JSON.parse(await readFile(checkpoint,'utf8'));
      if (catalog.version!==1 || catalog.signature!==signature) throw discoveryError('discovery-checkpoint-scope-mismatch');
    } else {
      try { await readFile(checkpoint); throw discoveryError('discovery-checkpoint-exists'); }
      catch (error) { if (error.code!=='ENOENT') throw error; }
      catalog = {version:1,signature,scope,model:provider.model,createdAt:new Date().toISOString(),
        databaseWrites:false,authoritative:false,states:[]};
    }
    let saving=Promise.resolve();
    const save = ()=> saving=saving.then(async()=>{
      catalog.updatedAt=new Date().toISOString();
      await writeFile(`${checkpoint}.tmp`,`${JSON.stringify(catalog,null,2)}\n`);
      await rename(`${checkpoint}.tmp`,checkpoint);
    });
    await save();
    let cursor=0;
    const worker=async()=>{while(cursor<scope.states.length) {
      const state=scope.states[cursor++];
      const previous=catalog.states.find(s=>s.state===state);
      if (previous?.status==='proposed') { onProgress({state,status:'resumed'}); continue; }
      const authority=inventory.states.find(s=>s.state===state);
      const entry={state,authorityUrl:authority?.authorityDirectoryUrl,attempts:(previous?.attempts??0)+1,
        checkedAt:new Date().toISOString(),status:'failed',sources:[]};
      try {
        if (!authority) throw discoveryError('discovery-authority-required');
        const origin=publicUrl(authority.authorityDirectoryUrl).origin;
        entry.sources=(await provider.search({state,authorityUrl:authority.authorityDirectoryUrl,scope}))
          .filter(s=>{try{return publicUrl(s.url).origin===origin;}catch{return false;}})
          .map(s=>({url:publicUrl(s.url).href,title:s.title??'',status:'proposed'}));
        entry.status=entry.sources.length ? 'proposed' : 'no-results';
      } catch(error) { entry.errorCode=safeCode(error); }
      catalog.states=catalog.states.filter(s=>s.state!==state).concat(entry).sort((a,b)=>a.state.localeCompare(b.state));
      await save(); // Commit before announcing progress; a later failure cannot lose this state.
      onProgress({state,status:entry.status,sources:entry.sources.length,errorCode:entry.errorCode});
    }};
    // allSettled keeps the lock until every in-flight request/save has stopped.
    const workers=await Promise.allSettled(Array.from({length:concurrency},worker));
    const failure=workers.find(w=>w.status==='rejected');
    if(failure) throw failure.reason;
    return catalog;
  } finally { await lock.close(); await unlink(`${checkpoint}.lock`); }
}

// Offline DB-free acceptance surface: keep original bytes before parsing and
// isolate failure to its source. This report deliberately never claims complete.
export async function inspectSourceBatch({scope,sources,archiveDirectory,provider,fetcher=fetchPublic,resume=false,onProgress=()=>{}}) {
  if (!archiveDirectory) throw discoveryError('discovery-archive-required');
  const selected=sources.filter(s=>scope.states.includes(s.state));
  selected.forEach(s=>validateSource(s,scope));
  await mkdir(archiveDirectory,{recursive:true});
  let lock;
  try{lock=await open(join(archiveDirectory,'inspection.lock'),'wx');}
  catch{throw discoveryError('discovery-checkpoint-locked');}
  try {
  const signature=sha256(stableJson({scope,sources:selected,model:provider?.model??null,promptVersion:provider?.promptVersion??null}));
  let report={version:1,signature,scope,createdAt:new Date().toISOString(),databaseWrites:false,status:'partial',sources:[],coverage:[]};
  const reportPath=join(archiveDirectory,'report.json');
  const save=async()=>{
    await writeFile(`${reportPath}.tmp`,`${JSON.stringify(report,null,2)}\n`);
    await rename(`${reportPath}.tmp`,reportPath);
  };
  if(resume) {
    report=JSON.parse(await readFile(reportPath,'utf8'));
    if(report.signature!==signature) throw discoveryError('discovery-checkpoint-scope-mismatch');
  } else {
    try{await readFile(reportPath);throw discoveryError('discovery-checkpoint-exists');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  for (const source of selected) {
    if(report.sources.some(s=>s.sourceId===source.id && s.status==='validated-sample')) {
      onProgress({state:source.state,sourceId:source.id,status:'resumed'});continue;
    }
    const result={sourceId:source.id,state:source.state,url:source.url,source,status:'failed',records:[],
      model:['wy-csv','mapped-csv'].includes(source.format)?null:provider?.model,
      promptVersion:['wy-csv','mapped-csv'].includes(source.format)?'none':provider?.promptVersion};
    try {
      const response=await fetcher(source.url,{allowedOrigins:source.allowedOrigins});
      const hash=sha256(response.bytes),file=`${hash}.bin`;
      // Content addressing avoids arbitrary source IDs becoming paths.
      await writeFile(join(archiveDirectory,file),response.bytes,{flag:'wx'}).catch(async e=>{
        if(e.code!=='EEXIST')throw e;
        if(sha256(await readFile(join(archiveDirectory,file)))!==hash) throw discoveryError('discovery-archive-conflict');
      });
      Object.assign(result,{archive:file,sha256:hash,retrievedAt:response.retrievedAt,finalUrl:response.finalUrl,
        mediaType:response.headers['content-type']??'',source});
      const text=await documentText(response.bytes,result.mediaType,source.format);
      if (!text.trim() || text.length>300000) throw discoveryError('discovery-document-text-limit');
      result.textFile=`${hash}-${sha256(text)}.txt`;
      await writeFile(join(archiveDirectory,result.textFile),text,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
      const rows=source.format==='wy-csv' ? extractWyoming(text,source,scope) : source.format==='mapped-csv' ? extractMappedCsv(text,source,scope) : await provider.extract({text,source});
      const checks=['wy-csv','mapped-csv'].includes(source.format) ? null : await provider.verify({text,source,rows});
      result.records=validateBallotRows(rows,text,source,scope,checks);
      result.valid=result.records.filter(r=>r.validation.outcome==='valid').length;
      result.status=result.records.length && result.valid===result.records.length ? 'validated-sample' : 'needs-review';
      result.races=source.races.filter(r=>scope.offices.includes(r.race.office)).map(r=>({race:r.race,
        records:result.records.filter(row=>stableJson(row.data.race)===stableJson(r.race)).length}));
      result.gaps=['candidate-list completeness review','corrections audit','FEC reconciliation','campaign-site verification'];
      if(result.races.some(r=>!r.records)) result.gaps.push('reviewed race has no extracted candidates');
    } catch(error) { result.errorCode=safeCode(error); }
    const previous=report.sources.find(s=>s.sourceId===source.id);
    if(previous) result.previousAttempts=[...(previous.previousAttempts??[]),{...previous,previousAttempts:undefined}];
    report.sources=report.sources.filter(s=>s.sourceId!==source.id).concat(result);
    // Save after each source, including failures and archived-but-unparsed input.
    await save();
    onProgress({state:source.state,sourceId:source.id,status:result.status,records:result.records.length,errorCode:result.errorCode});
  }
  report.coverage=scope.states.flatMap(state=>scope.offices.map(office=>{
    const found=report.sources.filter(s=>s.state===state && s.source?.races.some(r=>r.race.office===office));
    return {state,office,status:!found.length?'unsupported':found.every(s=>s.status==='failed')?'failed':'partial',
      sources:found.map(s=>s.sourceId)};
  }));
  await save();
  return report;
  } finally {await lock.close();await unlink(join(archiveDirectory,'inspection.lock'));}
}

export function onboardingCoverage({scope,inventory,catalog,sources=[],inspection}) {
  return {version:1,scope,generatedAt:new Date().toISOString(),databaseWrites:false,status:'partial',
    meaning:'Source onboarding evidence only. No production import or complete nationwide acceptance.',
    states:scope.states.map(state=>{
      const authority=inventory.states.find(s=>s.state===state),proposal=catalog?.states.find(s=>s.state===state);
      const reviewed=sources.filter(s=>s.state===state),results=inspection?.sources.filter(s=>s.state===state)??[];
      const existingPartial=Object.values(authority?.offices??{}).some(o=>o.coverage==='partial');
      return {state,name:authority?.name,authorityUrl:authority?.authorityDirectoryUrl,
        searchStatus:proposal?.status??'unresearched',proposals:proposal?.sources.length??0,
        reviewedSources:reviewed.map(s=>s.id),extraction:results.map(r=>({sourceId:r.sourceId,status:r.status,records:r.records.length,valid:r.valid??0,errorCode:r.errorCode})),
        offices:scope.offices.map(office=>({office,status:authority?.offices?.[office]?.coverage==='partial'||results.some(r=>r.source?.races.some(race=>race.race.office===office)&&r.records.some(row=>row.validation.outcome==='valid'&&row.data.race?.office===office))?'partial':'unsupported'})),
        gaps:[...(!reviewed.length&&!existingPartial?['official candidate source/race review']:[]),...(!results.length&&!existingPartial?['archived extraction acceptance']:[]),
          'complete candidate-list comparison','withdrawals/corrections audit','FEC reconciliation','campaign-site verification','production acceptance']};
    })};
}
