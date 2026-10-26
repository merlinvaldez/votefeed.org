import { CheerioCrawler, Configuration } from 'crawlee';
import { cleanCampaignHtml } from './cleanCampaignHtml.js';
import { resolvePublic } from './publicHttp.js';
import { publicUrl, discoveryError } from './discoveryUtils.js';

const DISALLOWED_HOST_PATTERNS = [
  /actblue\.com$/i,
  /winred\.com$/i,
  /paypal\.com$/i,
  /stripe\.com$/i,
  /facebook\.com$/i,
  /twitter\.com$/i,
  /x\.com$/i,
  /instagram\.com$/i,
  /youtube\.com$/i,
  /tiktok\.com$/i,
  /linkedin\.com$/i
];

const STATIC_EXTENSIONS = /\.(pdf|png|jpe?g|gif|svg|css|js|ico|webp|mp4|webm|zip|tar|gz|json|xml)$/i;

const POLICY_KEYWORDS = /issue|priorit|platform|agenda|vision|policy|positions?|record|stand|about/i;

export function isApprovedDestination(urlStr, approvedDestinations) {
  try {
    const target = publicUrl(urlStr);
    if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) return false;
    for (const pattern of DISALLOWED_HOST_PATTERNS) {
      if (pattern.test(target.hostname)) return false;
    }
    if (!Array.isArray(approvedDestinations) || !approvedDestinations.length) return false;
    return approvedDestinations.some(d => {
      const dOrigin = d.origin;
      const dPrefix = d.pathPrefix || '/';
      return target.origin === dOrigin && (target.pathname === dPrefix || target.pathname.startsWith(dPrefix.endsWith('/') ? dPrefix : `${dPrefix}/`));
    });
  } catch {
    return false;
  }
}

/**
 * Crawls a verified campaign site within bounded limits and approved destinations.
 *
 * @param {object} options
 * @param {object} options.site The campaign_sites record with approved_destinations
 * @param {string} [options.startUrl] Optional start URL (defaults to site.proposed_url)
 * @param {number} [options.maxPages=5] Maximum pages to crawl
 * @param {number} [options.maxConcurrency=1] Concurrency limit
 * @param {boolean} [options.checkDns=true] Whether to enforce public DNS checks
 * @param {function} [options.customFetcher] Optional mock fetcher for tests
 * @returns {Promise<{ status: string, pages: Array<{ requestedUrl: string, finalUrl: string, text: string, retrievedAt: string }> }>}
 */
export async function crawlCampaignSite({
  site,
  startUrl,
  maxPages = 5,
  maxConcurrency = 1,
  checkDns = true,
  customFetcher = null
} = {}) {
  if (!site) throw discoveryError('crawl-site-missing');
  if (site.status !== 'verified') throw discoveryError('crawl-site-unverified');
  if (site.review_after && new Date(site.review_after) <= new Date()) throw discoveryError('crawl-site-expired');

  const initialUrl = startUrl || site.proposed_url;
  if (!initialUrl) throw discoveryError('crawl-site-missing');

  const approvedDestinations = site.approved_destinations || [];
  if (!isApprovedDestination(initialUrl, approvedDestinations)) {
    throw discoveryError('crawl-unapproved-destination');
  }

  // If a custom fetcher is provided (for tests / offline fixtures)
  if (typeof customFetcher === 'function') {
    const result = await customFetcher({ initialUrl, site, maxPages, approvedDestinations });
    return result;
  }

  const pages = [];
  const visitedUrls = new Set();
  const config = new Configuration({ persistStorage: false, purgeOnStart: true });

  const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: maxPages,
    maxConcurrency,
    requestHandlerTimeoutSecs: 15,
    maxRequestRetries: 1,
    preNavigationHooks: [
      async ({ request }) => {
        if (!isApprovedDestination(request.url, approvedDestinations)) {
          request.noRetry = true;
          throw discoveryError('crawl-unapproved-destination');
        }
        if (checkDns) {
          await resolvePublic(request.url);
        }
      }
    ],
    async requestHandler({ request, $, body }) {
      const finalUrl = request.loadedUrl || request.url;
      if (!isApprovedDestination(finalUrl, approvedDestinations)) {
        return;
      }

      visitedUrls.add(request.url);
      visitedUrls.add(finalUrl);

      const html = typeof body === 'string' ? body : $.html();
      const text = cleanCampaignHtml(html);

      pages.push({
        requestedUrl: request.url,
        finalUrl,
        text,
        retrievedAt: new Date().toISOString()
      });

      // Discover additional links if under maxPages
      if (pages.length < maxPages) {
        const candidateLinks = [];
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href');
          if (!href) return;
          try {
            const resolved = new URL(href, finalUrl);
            resolved.hash = ''; // strip fragment
            const linkStr = resolved.href;
            if (visitedUrls.has(linkStr)) return;
            if (STATIC_EXTENSIONS.test(resolved.pathname)) return;
            if (!isApprovedDestination(linkStr, approvedDestinations)) return;

            // Prioritize links matching policy keywords
            const score = POLICY_KEYWORDS.test(resolved.pathname) || POLICY_KEYWORDS.test($(el).text()) ? 1 : 0;
            candidateLinks.push({ url: linkStr, score });
          } catch {
            // Ignore invalid URLs
          }
        });

        // Sort priority links first
        candidateLinks.sort((a, b) => b.score - a.score);

        for (const candidate of candidateLinks) {
          if (!visitedUrls.has(candidate.url) && visitedUrls.size < maxPages * 2) {
            visitedUrls.add(candidate.url);
            await crawler.addRequests([{ url: candidate.url }]);
          }
        }
      }
    },
    async failedRequestHandler({ request, error }) {
      console.warn('crawl_page_failed', { url: request.url, error: error.message });
    }
  }, config);

  try {
    await crawler.run([initialUrl]);
  } catch (error) {
    if (pages.length === 0) {
      throw discoveryError(error.code?.startsWith('discovery-') || error.code?.startsWith('crawl-') ? error.code : 'crawl-failed');
    }
  }

  if (pages.length === 0) {
    throw discoveryError('crawl-failed');
  }

  return {
    status: 'success',
    pages
  };
}
