import test from 'node:test';
import assert from 'node:assert/strict';
import { collectCampaignSitePages, createCampaignSiteSearchProvider } from '../server/src/elections/campaignSiteSearch.js';

const candidate = {
  name:'Alex Example',office:'house',state:'WY',district:0,senateSeat:null,
  electionDate:'2026-11-03',fecId:'H6WY00001',candidacy_id:'candidacy-1',
};
const siteUrl='https://alexexample2026.org/';
const sourceExcerpt={
  candidateNameExcerpt:'Alex Example',
  officeExcerpt:'Alex Example is running for the U.S. House.',
  stateExcerpt:'Alex is a Wyoming candidate.',
  districtExcerpt:'Wyoming has just one seat in the U.S. House.',
};
const matchedDecision={
  verdict:'match',candidateNameMatch:true,officeMatch:true,stateMatch:true,districtMatch:true,
  ...sourceExcerpt,reason:'The campaign pages identify the candidate and same at-large Wyoming House race.',
};
const aiResponse=(value,sources=[])=>({
  status:'completed',output_text:JSON.stringify(value),
  output:sources.length ? [{type:'web_search_call',action:{sources}}] : [],
});
const page=(url,text,links=[])=>({url,retrievedAt:'2026-10-27T12:00:00.000Z',title:'Alex Example for Congress',text,links});
const matchText=[
  'Alex Example',
  'Alex Example is running for the U.S. House.',
  'Alex is a Wyoming candidate.',
  'Wyoming has just one seat in the U.S. House.',
].join(' ');
const noSitemap=async()=>{throw Object.assign(new Error('unavailable'),{code:'discovery-http-failed'});};

function providerWith(aiResponses,options={}) {
  const responses=[...aiResponses];
  const client={responses:{create:async()=>{
    const next=responses.shift();
    assert.ok(next,'unexpected AI request');
    return next;
  }}};
  return createCampaignSiteSearchProvider({client,...options});
}

test('search accepts a likely campaign URL when web citations do not share its domain',async()=>{
  const provider=providerWith([aiResponse({found:true,siteUrl,reason:'Search results identify the candidate campaign site.'},[
    {url:'https://ballotpedia.org/Alex_Example',title:'Alex Example'},
  ])]);
  const result=await provider.search(candidate);
  assert.equal(result.siteUrl,siteUrl);
  assert.equal(result.sourceBacked,true);
  assert.equal(result.sources[0].url,'https://ballotpedia.org/Alex_Example');
});

test('site inspection accepts exact at-large evidence from sitemap pages without requiring the words at-large',async()=>{
  const about=page('https://alexexample2026.org/about',matchText);
  const fetched=[];
  const pageFetcher=async url=>{
    fetched.push(url);
    if (url===about.url) return about;
    throw new Error(`Unexpected page ${url}`);
  };
  const sitemapFetcher=async url=>{
    if (url.endsWith('/robots.txt')) return {bytes:Buffer.from('Sitemap: https://alexexample2026.org/sitemap.xml')};
    if (url.endsWith('/sitemap.xml')) return {bytes:Buffer.from(
      '<urlset><url><loc>https://alexexample2026.org/about</loc></url></urlset>')};
    throw new Error(`Unexpected sitemap URL ${url}`);
  };
  const provider=providerWith([aiResponse(matchedDecision)],{pageFetcher,sitemapFetcher});
  const result=await provider.inspect(candidate,siteUrl);
  assert.equal(result.matched,true);
  assert.equal(result.status,'verified');
  assert.deepEqual(fetched,[about.url]);
  assert.equal(result.evidence.district.excerpt,sourceExcerpt.districtExcerpt);
  assert.equal(result.evidence.district.pageUrl,about.url);
});

test('site titles can support evidence and an FEC middle name can match a campaign name',async()=>{
  const aliasedCandidate={...candidate,name:'BITEMAN, DENNIS BO DEAN II'};
  const title='Bo Biteman for Congress in Wyoming';
  const evidencePage=page('https://alexexample2026.org/about','Wyoming deserves a congressman. Bo would represent Wyoming in Congress.');
  evidencePage.title=title;
  const decision={
    verdict:'match',candidateNameMatch:true,officeMatch:true,stateMatch:true,districtMatch:true,
    candidateNameExcerpt:'Bo Biteman',officeExcerpt:'Bo Biteman for Congress',stateExcerpt:'Wyoming',
    districtExcerpt:title,reason:'The title and page identify the same Wyoming at-large House candidacy.',
  };
  const sitemapFetcher=async url=>url.endsWith('/robots.txt')
    ? {bytes:Buffer.from('Sitemap: https://alexexample2026.org/sitemap.xml')}
    : {bytes:Buffer.from('<urlset><url><loc>https://alexexample2026.org/about</loc></url></urlset>')};
  const provider=providerWith([aiResponse(decision)],{
    pageFetcher:async()=>evidencePage,sitemapFetcher,
  });
  const result=await provider.inspect(aliasedCandidate,siteUrl);
  assert.equal(result.status,'verified');
  assert.equal(result.evidence.district.pageUrl,evidencePage.url);
  assert.equal(result.evidence.candidateName.excerpt,'Bo Biteman');
});

test('domain-restricted search finds same-site evidence pages when no relevant sitemap pages exist',async()=>{
  const calls=[];
  const fetched=[];
  const client={responses:{create:async request=>{
    calls.push(request);
    if (calls.length===1) return aiResponse({},[
      {url:'https://alexexample2026.org/key-issues',title:'Key Issues - Alex Example'},
      {url:'https://external.example/issues',title:'External campaign issues'},
      {url:siteUrl,title:'Alex Example Homepage'},
    ]);
    return aiResponse(matchedDecision);
  }}};
  const sitemapFetcher=async url=>url.endsWith('/robots.txt')
    ? {bytes:Buffer.from('Sitemap: https://alexexample2026.org/sitemap.xml')}
    : {bytes:Buffer.from(`<urlset><url><loc>${siteUrl}</loc></url></urlset>`)};
  const provider=createCampaignSiteSearchProvider({client,sitemapFetcher,pageFetcher:async url=>{
    fetched.push(url);
    return page(url,matchText);
  }});
  const result=await provider.inspect(candidate,siteUrl);
  assert.equal(result.status,'verified');
  assert.equal(result.evidence.pageDiscoverySource,'domain-search');
  assert.deepEqual(fetched,['https://alexexample2026.org/key-issues']);
  assert.deepEqual(calls[0].tools[0].filters.allowed_domains,['alexexample2026.org']);
  assert.match(calls[0].input,/key-issues/i);
  assert.match(calls[0].input,/site:alexexample2026\.org/i);
  assert.match(calls[0].instructions,/\/key-issues/i);
  assert.equal(calls.length,2);
});

test('policy-page fallback returns only relevant pages on the approved site domain',async()=>{
  const provider=providerWith([aiResponse({},[
    {url:'https://alexexample2026.org/key-issues',title:'Key Issues'},
    {url:'https://alexexample2026.org/contact',title:'Contact'},
    {url:'https://elsewhere.example/policies',title:'Policies'},
    {url:siteUrl,title:'Homepage - Policies'},
  ])],{
    sitemapFetcher:noSitemap,
  });
  const discovery=await provider.findPageUrls(candidate,siteUrl,{policyOnly:true});
  assert.deepEqual(discovery,{urls:['https://alexexample2026.org/key-issues'],source:'domain-search'});
});

test('sitemap indexes are followed and oversized homepages are never fetched',async()=>{
  const sitemapRequests=[];
  const pageRequests=[];
  const sitemapFetcher=async url=>{
    sitemapRequests.push(url);
    if (url.endsWith('/robots.txt')) return {bytes:Buffer.from('Sitemap: https://alexexample2026.org/sitemap-index.xml')};
    if (url.endsWith('/sitemap-index.xml')) return {bytes:Buffer.from(
      '<sitemapindex><sitemap><loc>https://alexexample2026.org/policy-pages.xml</loc></sitemap></sitemapindex>')};
    if (url.endsWith('/policy-pages.xml')) return {bytes:Buffer.from(
      '<urlset><url><loc>https://alexexample2026.org/</loc></url>'+
      '<url><loc>https://alexexample2026.org/key-issues</loc></url>'+
      '<url><loc>https://alexexample2026.org/policies</loc></url>'+
      '<url><loc>https://alexexample2026.org/contact</loc></url></urlset>')};
    throw Object.assign(new Error('Not found'),{code:'discovery-http-failed'});
  };
  const pages=await collectCampaignSitePages(siteUrl,{
    maxPages:5,
    sitemapFetcher,
    fetcher:async url=>{
      pageRequests.push(url);
      if (url==='https://alexexample2026.org/') throw new Error('Homepage must not be fetched.');
      return page(url,'Campaign policy detail page.');
    },
  });
  assert.ok(sitemapRequests.includes('https://alexexample2026.org/sitemap-index.xml'));
  assert.ok(sitemapRequests.includes('https://alexexample2026.org/policy-pages.xml'));
  assert.deepEqual(pageRequests,[
    'https://alexexample2026.org/key-issues',
    'https://alexexample2026.org/policies',
  ]);
  assert.deepEqual(pages.map(item=>item.url),pageRequests);
});

test('a site without a usable sitemap or domain-search pages stays unverified without fetching homepage or navigation pages',async()=>{
  const fetched=[];
  const provider=providerWith([aiResponse({})],{
    pageFetcher:async url=>{fetched.push(url);return page(url,matchText);},sitemapFetcher:noSitemap,
  });
  const result=await provider.inspect(candidate,siteUrl);
  assert.equal(result.status,'ambiguous');
  assert.match(result.reason,/sitemap and domain-restricted search/i);
  assert.equal(result.evidence.pageDiscoverySource,'domain-search');
  assert.deepEqual(fetched,[]);
});

test('a conflicting race is rejected even when the candidate name is similar',async()=>{
  const wrongRace={
    verdict:'mismatch',candidateNameMatch:true,officeMatch:true,stateMatch:false,districtMatch:false,
    candidateNameExcerpt:'Alex Example',officeExcerpt:'Alex Example is running for the U.S. House.',
    stateExcerpt:'Alex is a Colorado candidate.',districtExcerpt:'Colorado has a congressional district.',
    reason:'The page identifies a Colorado race rather than the requested Wyoming race.',
  };
  const conflictingText='Alex Example Alex Example is running for the U.S. House. Alex is a Colorado candidate. Colorado has a congressional district.';
  const racePage=page('https://alexexample2026.org/issues',conflictingText);
  const sitemapFetcher=async url=>url.endsWith('/robots.txt')
    ? {bytes:Buffer.from('Sitemap: https://alexexample2026.org/sitemap.xml')}
    : {bytes:Buffer.from('<urlset><url><loc>https://alexexample2026.org/issues</loc></url></urlset>')};
  const provider=providerWith([aiResponse(wrongRace)],{
    pageFetcher:async()=>racePage,sitemapFetcher,
  });
  const result=await provider.inspect(candidate,siteUrl);
  assert.equal(result.matched,false);
  assert.equal(result.status,'rejected');
});

test('no-site search and inaccessible-site fetch remain distinct outcomes',async()=>{
  const noSiteProvider=providerWith([aiResponse({found:false,siteUrl:null,reason:'No likely campaign site found.'})]);
  const missing=await noSiteProvider.search(candidate);
  assert.equal(missing.found,false);
  assert.equal(missing.siteUrl,null);

  const dnsError=Object.assign(new Error('DNS failed'),{code:'discovery-dns-failed'});
  const inaccessibleProvider=providerWith([],{
    pageFetcher:async()=>{throw new Error('The sitemap fetch should fail first.');},
    sitemapFetcher:async()=>{throw dnsError;},
  });
  await assert.rejects(inaccessibleProvider.inspect(candidate,siteUrl),error=>error.code==='discovery-dns-failed');
});
