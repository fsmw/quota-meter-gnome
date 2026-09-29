import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addTokenCounters,
  consumeSessionUsageLine,
  createSessionUsageAccumulator,
  deriveTokenCounters,
} from '../extension/session-usage-parser.js';

const usageLine = usage => JSON.stringify({
  type: 'event_msg',
  payload: {type: 'token_count', info: {last_token_usage: usage}},
});

test('sums known Codex token dimensions and leaves absent dimensions absent', () => {
  const totals = createSessionUsageAccumulator();
  consumeSessionUsageLine(totals, usageLine({
    input_tokens: 12, cached_input_tokens: 4, output_tokens: 8, total_tokens: 20,
  }));
  consumeSessionUsageLine(totals, usageLine({input_tokens: 3, output_tokens: 2, total_tokens: 5}));

  assert.deepEqual(totals.tokens, {inputTotal: 15, cachedInput: 4, output: 10, total: 25});
  assert.deepEqual(deriveTokenCounters(totals.tokens), {
    inputTotal: 15, input: 11, cachedInput: 4, output: 10, total: 25,
  });
  assert.equal(totals.hasUsage, true);
  assert.equal(Object.hasOwn(totals.tokens, 'reasoningOutput'), false);
});

test('ignores unrelated events and marks malformed complete lines for partial status', () => {
  const totals = createSessionUsageAccumulator();
  consumeSessionUsageLine(totals, JSON.stringify({type: 'turn_context'}));
  consumeSessionUsageLine(totals, '{partial');

  assert.deepEqual(totals.tokens, {});
  assert.equal(totals.hasUsage, false);
  assert.equal(totals.invalidLines, 1);
});

test('aggregates only dimensions actually observed across sessions', () => {
  const combined = addTokenCounters({input: 10, total: 15}, {input: 2, output: 5, total: 7});
  assert.deepEqual(combined, {input: 12, total: 22, output: 5});
});
