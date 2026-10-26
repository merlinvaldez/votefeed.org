import * as cheerio from 'cheerio';

const STRIP_TAGS = ['script', 'style', 'noscript', 'svg', 'nav', 'footer', 'header', 'aside', 'form', 'iframe', 'button', 'input', 'select', 'textarea'];

const STRIP_SELECTORS = [
  '[class*="donate"]', '[id*="donate"]',
  '[class*="fundrais"]', '[id*="fundrais"]',
  '[class*="cookie"]', '[id*="cookie"]',
  '[class*="modal"]', '[id*="modal"]',
  '[class*="popup"]', '[id*="popup"]',
  '[class*="newsletter"]', '[id*="newsletter"]',
  'a[href*="actblue.com"]', 'a[href*="winred.com"]'
];

/**
 * Clean campaign HTML page into readable text preserving headings, paragraphs, and lists.
 * Removes boilerplate, navigation, footer, donation prompts, and script/style tags.
 *
 * @param {string} html Raw HTML string
 * @returns {string} Cleaned plain text with structured headings and paragraphs
 */
export function cleanCampaignHtml(html) {
  if (typeof html !== 'string' || !html.trim()) return '';
  const $ = cheerio.load(html);

  // Remove unwanted elements
  for (const tag of STRIP_TAGS) {
    $(tag).remove();
  }
  for (const selector of STRIP_SELECTORS) {
    $(selector).remove();
  }

  // Replace block tags with newline delimiters to preserve boundaries
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    $(el).before('\n\n').after('\n\n');
  });
  $('p, div, section, article, blockquote').each((_, el) => {
    $(el).before('\n').after('\n');
  });
  $('li').each((_, el) => {
    $(el).before('\n- ').after('\n');
  });
  $('br').replaceWith('\n');

  // Extract text from body (or root if body absent)
  const root = $('body').length ? $('body') : $.root();
  const rawText = root.text();

  // Normalize lines and whitespace
  const lines = rawText.split('\n').map(line => line.trim()).filter(Boolean);
  const normalizedText = lines.join('\n\n');

  return normalizedText;
}
