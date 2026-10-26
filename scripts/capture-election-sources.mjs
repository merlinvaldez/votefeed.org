import { readFile,writeFile,mkdir,rename } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { fetchPublic } from '../server/src/elections/publicHttp.js';
import { documentText } from '../server/src/elections/ballotExtraction.js';
import { publicUrl,sha256,safeCode } from '../server/src/elections/discoveryUtils.js';
const {load}=createRequire(new URL('../server/package.json',import.meta.url))('cheerio');
const {values}=parseArgs({options:{input:{type:'string'},archive:{type:'string'}}});
if(!values.input||!values.archive)throw new Error('Use --input reviewed-urls.json --archive new-directory');
const inputs=JSON.parse(await readFile(values.input,'utf8'));
if(!Array.isArray(inputs)||inputs.length>100)throw new Error('Invalid capture input');
inputs.forEach(s=>{if(!s.state||!s.id||!s.allowedOrigins?.includes(publicUrl(s.url).origin))throw new Error('Reviewed origin required');
  if(s.maxBytes && (!Number.isInteger(s.maxBytes)||s.maxBytes<1||s.maxBytes>20_000_000))throw new Error('Capture size must be reviewed and at most 20 MB');});
await mkdir(values.archive,{recursive:true});
const manifestPath=join(values.archive,'captures.json');
// Reserve this batch before any network work. Subsequent research rounds use a
// new directory, preserving failed requests and prior captured evidence.
const manifest={version:1,createdAt:new Date().toISOString(),databaseWrites:false,captures:[]};
await writeFile(manifestPath,JSON.stringify(manifest,null,2),{flag:'wx'});
let saving=Promise.resolve(),cursor=0;
const save=()=>saving=saving.then(async()=>{await writeFile(`${manifestPath}.tmp`,JSON.stringify(manifest,null,2)+'\n');await rename(`${manifestPath}.tmp`,manifestPath);});
async function worker(){while(cursor<inputs.length){const source=inputs[cursor++],entry={...source,status:'failed'};
  try{
    const r=await fetchPublic(source.url,{allowedOrigins:source.allowedOrigins,retries:0,maxBytes:source.maxBytes??4_000_000});
    const hash=sha256(r.bytes);Object.assign(entry,{status:'captured',sha256:hash,bytes:r.bytes.length,requestedUrl:r.requestedUrl,finalUrl:r.finalUrl,retrievedAt:r.retrievedAt,mediaType:r.headers['content-type']??'',httpStatus:r.status,headers:r.headers,file:`${hash}.bin`});
    await writeFile(join(values.archive,entry.file),r.bytes,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    try{const text=await documentText(r.bytes,entry.mediaType,'ai');entry.textFile=`${hash}.txt`;await writeFile(join(values.archive,entry.textFile),text);entry.textLength=text.length;}
    catch(e){entry.parseError=safeCode(e);}
    if(/html/.test(entry.mediaType)){const $=load(r.bytes);entry.links=$('a[href]').map((i,a)=>{try{return {text:$(a).text().trim(),url:new URL($(a).attr('href'),r.finalUrl).href};}catch{return null;}}).get().filter(l=>l&&/candidate|certif|2026|general|withdraw|amend|november/i.test(l.text+' '+l.url));}
  }catch(e){entry.errorCode=safeCode(e);}
  manifest.captures.push(entry);await save();console.log(JSON.stringify({state:source.state,id:source.id,status:entry.status,bytes:entry.bytes,error:entry.errorCode}));
}}
const results=await Promise.allSettled(Array.from({length:3},worker));await saving;
if(results.some(r=>r.status==='rejected'))throw new Error('Capture persistence failed');
