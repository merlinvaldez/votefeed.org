import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from '../client/node_modules/vite/dist/node/index.js';
import react from '../client/node_modules/@vitejs/plugin-react-swc/index.js';
import * as summaries from '../client/src/feedSummaries.js';
const require = createRequire(new URL('../client/package.json', import.meta.url));
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

test('bill summary preference falls back to AI until official text exists', () => {
  assert.equal(typeof summaries.shouldShowOfficialSummary, 'function');
  for (const summary of [null, '', ' ', {}, { officialHtml: '' }]) {
    assert.equal(summaries.shouldShowOfficialSummary(summary, true), false);
  }
  assert.equal(summaries.shouldShowOfficialSummary('<p>Official</p>'), true);
  assert.equal(summaries.shouldShowOfficialSummary('<p>Official</p>', false), false);
});

test('shared toggle disables missing official text and explains availability on hover', async () => {
  const server = await createServer({ root: process.cwd() + '/client', configFile: false,
    envDir: false, optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [react()], server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { default: Toggle } = await server.ssrLoadModule('/src/SummarySourceToggle.jsx');
    const missing = renderToStaticMarkup(createElement(Toggle, { officialHtml: null, showOriginal: false }));
    assert.match(missing, /disabled=""/);
    assert.match(missing, /title="Official summary not yet available"/);
    assert.match(missing, /aria-label="Official summary not yet available"/);
    const available = renderToStaticMarkup(createElement(Toggle, { officialHtml: '<p>Official</p>', showOriginal: false }));
    assert.doesNotMatch(available, /disabled=""/);
    assert.match(available, /original from Congress.gov/);
  } finally { await server.close(); }
});
