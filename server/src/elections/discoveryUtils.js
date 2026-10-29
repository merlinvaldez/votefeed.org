import { createHash } from 'node:crypto';
import { RELEASE_SCOPE, normalizeDistrict, normalizeState } from './contracts.js';

export const DISCOVERY_VERSION = 'discovery-v1';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function discoveryError(code) { return Object.assign(new Error(code), { code }); }
export function safeCode(error) {
  return /^discovery-[a-z-]{1,60}$/.test(error?.code) ? error.code : 'discovery-operation-failed';
}
export function discoveryScope(input = {}) {
  const scope = { ...RELEASE_SCOPE, ...input };
  if (scope.cycle !== 2026 || scope.stage !== 'general' || scope.contestType !== 'regular'
    || scope.geography !== RELEASE_SCOPE.geography || !Array.isArray(scope.states) || !scope.states.length
    || !Array.isArray(scope.offices) || !scope.offices.length
    || scope.states.some(s => !RELEASE_SCOPE.states.includes(s))
    || scope.offices.some(o => !RELEASE_SCOPE.offices.includes(o))) throw discoveryError('discovery-invalid-scope');
  const states=[...new Set(scope.states)].map(normalizeState).sort(), offices=[...new Set(scope.offices)].sort();
  if (scope.district !== undefined && (offices.length!==1 || offices[0]!=='house' || states.length!==1)) {
    throw discoveryError('discovery-invalid-district-scope');
  }
  return { ...scope, ...(scope.district!==undefined ? {district:normalizeDistrict(scope.district)} : {}), states, offices };
}
export function publicUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw discoveryError('discovery-invalid-url'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443'
    || /(?:^|[?&])(api[_-]?key|token|secret|password)=/i.test(url.search)) throw discoveryError('discovery-invalid-url');
  url.hash = '';
  return url;
}
export function campaignUrl(value) {
  if (!value || typeof value !== 'string') return null;
  value = value.trim();
  try { return publicUrl(value.match(/^https?:/i) ? value : `https://${value}`).href; } catch { return null; }
}
