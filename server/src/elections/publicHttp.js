import https from 'node:https';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { discoveryError, publicUrl } from './discoveryUtils.js';

export function isPublicAddress(value) {
  try {
    let ip = ipaddr.parse(value);
    if (ip.kind() === 'ipv6' && ip.isIPv4MappedAddress()) ip = ip.toIPv4Address();
    return ip.range() === 'unicast';
  } catch { return false; }
}
export async function resolvePublic(url, resolve = lookup, timeoutMs = 15000) {
  const host = publicUrl(url).hostname.replace(/^\[|\]$/g, '');
  let addresses;
  let timer;
  try { addresses = await Promise.race([resolve(host, { all: true, verbatim: true }),
    new Promise((_done,reject)=>{timer=setTimeout(()=>reject(discoveryError('discovery-timeout')),timeoutMs);})]); }
  catch (error) { throw error.code === 'discovery-timeout' ? error : discoveryError('discovery-dns-failed'); }
  finally { clearTimeout(timer); }
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw discoveryError('discovery-private-destination');
  return addresses[0];
}
// Pin the checked address into the TLS request; validate every redirect separately.
export function requestPinned(url, address, { headers = {}, timeoutMs = 15000, maxBytes = 4_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'GET', headers: { 'User-Agent': 'VoteFeed-election-discovery/1.0', Accept: '*/*', 'Accept-Encoding': 'identity', ...headers },
      lookup: (_host, options, done) => done(null, options.all ? [address] : address.address, address.family),
    }, response => {
      const chunks = []; let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) request.destroy(discoveryError('discovery-response-too-large'));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    const timer = setTimeout(() => request.destroy(discoveryError('discovery-timeout')), timeoutMs);
    request.on('close', () => clearTimeout(timer));
    request.on('error', error => reject(error.code?.startsWith('discovery-') ? error : discoveryError('discovery-network-failed')));
    request.end();
  });
}
export async function fetchPublic(input, options = {}) {
  const { allowedOrigins, resolve = lookup, request = requestPinned, sleep = ms => new Promise(r => setTimeout(r, ms)),
    retries = 2, maxRedirects = 3, headers = {} } = options;
  if (!Array.isArray(allowedOrigins) || !allowedOrigins.length) throw discoveryError('discovery-origin-required');
  let url = publicUrl(input);
  const originalOrigin = url.origin;
  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    if (!allowedOrigins.includes(url.origin)) throw discoveryError('discovery-unapproved-redirect');
    let response;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const address = await resolvePublic(url.href, resolve, options.timeoutMs);
        response = await request(url, address, { ...options, headers: url.origin === originalOrigin ? headers : {} });
        if (![429, 500, 502, 503, 504].includes(response.status)) break;
        if (attempt === retries) throw discoveryError(response.status === 429 ? 'discovery-rate-limited' : 'discovery-source-unavailable');
      } catch (error) {
        if (attempt === retries || !['discovery-network-failed','discovery-timeout'].includes(error.code)) throw error;
      }
      const retryAfter = Number(response?.headers?.['retry-after']);
      // Never retry earlier than a long provider delay; stop this bounded run instead.
      if (retryAfter > 5 || response?.headers?.['retry-after'] && !Number.isFinite(retryAfter)) throw discoveryError('discovery-retry-deferred');
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt);
    }
    if ([301,302,303,307,308].includes(response.status)) {
      if (!response.headers.location || redirect === maxRedirects) throw discoveryError('discovery-redirect-limit');
      url = publicUrl(new URL(response.headers.location, url).href); continue;
    }
    if (response.status !== 200) throw discoveryError('discovery-http-failed');
    return { ...response, requestedUrl: publicUrl(input).href, finalUrl: url.href, retrievedAt: new Date().toISOString() };
  }
  throw discoveryError('discovery-redirect-limit');
}
