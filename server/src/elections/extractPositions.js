import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { TOPICS, validateExtractionItem } from './contracts.js';
import { discoveryError } from './discoveryUtils.js';

export const VALIDATOR_VERSION = 'campaign-validator-1.0';
export const PROMPT_VERSION = 'campaign-position-prompt-1.3';

/**
 * Deterministically hash candidacy and claimText into a standard UUID v4 format.
 * This guarantees repeatable claim IDs for unchanged claims.
 */
export function deterministicClaimId(candidacyId, claimText) {
  const h = createHash('sha256').update(`${candidacyId}:${claimText.trim().toLowerCase()}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Validates extracted items against snapshot text and schema requirements.
 *
 * @param {Array<object>} rawItems
 * @param {{ id: string, candidacyId: string, text: string }} snapshot
 * @returns {{ outcome: 'valid' | 'invalid', items: Array<object>, errors: Array<any> }}
 */
export function validateCampaignPositions(rawItems, snapshot) {
  if (!Array.isArray(rawItems)) {
    return { outcome: 'invalid', items: [], errors: ['not-an-array'] };
  }
  const validItems = [];
  const errors = [];
  const seenClaims = new Set();
  const seenTexts = new Set();

  for (const item of rawItems) {
    if (!item || typeof item !== 'object') {
      errors.push({ item, error: 'invalid-item-shape' });
      continue;
    }

    const claimText = typeof item.claimText === 'string' ? item.claimText.trim() : '';
    const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
    const excerpt = typeof item.excerpt === 'string' ? item.excerpt.trim() : '';
    const topic = typeof item.topic === 'string' ? item.topic.trim().toLowerCase() : '';

    const claimId = item.claimId || (claimText && snapshot.candidacyId ? deterministicClaimId(snapshot.candidacyId, claimText) : null);

    const candidateItem = {
      snapshotId: snapshot.id,
      candidacyId: snapshot.candidacyId,
      claimId,
      claimText,
      summary,
      excerpt,
      topic
    };

    const structural = validateExtractionItem(candidateItem, snapshot);
    if (structural.errors.length) {
      errors.push({ item: candidateItem, errors: structural.errors });
      continue;
    }

    if (seenClaims.has(claimId) || seenTexts.has(claimText)) {
      // Deduplicate: skip exact duplicate claim
      continue;
    }

    seenClaims.add(claimId);
    seenTexts.add(claimText);

    candidateItem.validation = {
      outcome: 'valid',
      validatorVersion: VALIDATOR_VERSION,
      reasons: ['structural-valid', 'excerpt-exact-match', 'topic-allowed']
    };

    validItems.push(candidateItem);
  }

  return {
    outcome: validItems.length > 0 || rawItems.length === 0 ? 'valid' : 'invalid',
    items: validItems,
    errors
  };
}

const positionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    topic: { type: 'string', enum: [...TOPICS] },
    claimText: { type: 'string' },
    summary: { type: 'string' },
    excerpt: { type: 'string' }
  },
  required: ['topic', 'claimText', 'summary', 'excerpt']
};

const envelopeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    positions: {
      type: 'array',
      items: positionSchema
    }
  },
  required: ['positions']
};

/**
 * Creates an extraction provider that runs the prompt against OpenAI or mock client.
 */
export function createCampaignExtractionProvider({
  client,
  model = process.env.ELECTIONS_AI_MODEL || process.env.OPENAI_MODEL || 'gpt-5.4',
  maxAttempts = 2
} = {}) {
  client ??= new OpenAI({ maxRetries: 0, timeout: 60000 });

  return {
    model,
    promptVersion: PROMPT_VERSION,
    async extractPositions(snapshot, candidate = null) {
      if (typeof snapshot.text !== 'string' || !snapshot.text.trim()) {
        return [];
      }
      if (snapshot.text.length > 100000) {
        throw discoveryError('discovery-ai-input-limit');
      }

      const promptText = await readFile(new URL('../ai/prompts/campaignPositionExtraction.md', import.meta.url), 'utf8');

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const response = await client.responses.create({
            model,
            store: false,
            instructions: promptText,
            input: JSON.stringify({
              candidate,
              candidacyId: snapshot.candidacyId,
              text: snapshot.text
            }),
            max_output_tokens: 12000,
            text: {
              format: {
                type: 'json_schema',
                name: 'campaign_positions',
                strict: true,
                schema: envelopeSchema
              }
            }
          });

          if (response.status !== 'completed' || !response.output_text) {
            throw discoveryError('discovery-ai-incomplete');
          }

          const parsed = JSON.parse(response.output_text);
          return parsed.positions || [];
        } catch (error) {
          if (attempt + 1 === maxAttempts || [400, 401, 403, 429].includes(error.status)) {
            throw discoveryError(error.status === 429 ? 'discovery-ai-rate-limited' : 'discovery-ai-failed');
          }
        }
      }
      throw discoveryError('discovery-ai-failed');
    }
  };
}
