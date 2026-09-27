import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeRateLimitsResponse,
} from '../extension/normalizer.js';
import {parseJsonLine} from '../extension/jsonl.js';

const FETCHED_AT = Date.UTC(2026, 8, 27, 12, 34, 56);
const RESET_AT = Date.UTC(2026, 8, 27, 17, 0, 0);

function windowLimit(usedPercent, windowDurationMins, resetsAt) {
  return {usedPercent, windowDurationMins, resetsAt};
}

test('normalizes every named limit bucket and its primary and secondary windows', () => {
  const result = normalizeRateLimitsResponse({
    rateLimitsByLimitId: {
      codex: {
        primary: windowLimit(23.5, 300, RESET_AT / 1000),
        secondary: windowLimit(61, 10080, (RESET_AT + 3600000) / 1000),
      },
      reviews: {
        primary: windowLimit(0, 60, RESET_AT / 1000),
      },
    },
  }, FETCHED_AT);

  assert.equal(result.providerId, 'openai');
  assert.equal(result.productId, 'codex-chatgpt');
  assert.equal(result.status, 'ok');
  assert.equal(result.fetchedAt, new Date(FETCHED_AT).toISOString());
  assert.deepEqual(result.metrics, [
    {
      id: 'codex:primary',
      kind: 'quota',
      scope: 'account',
      bucketId: 'codex',
      windowId: 'primary',
      usedPercent: 23.5,
      remainingPercent: 76.5,
      window: {
        durationSeconds: 18000,
        resetsAt: new Date(RESET_AT).toISOString(),
      },
    },
    {
      id: 'codex:secondary',
      kind: 'quota',
      scope: 'account',
      bucketId: 'codex',
      windowId: 'secondary',
      usedPercent: 61,
      remainingPercent: 39,
      window: {
        durationSeconds: 604800,
        resetsAt: new Date(RESET_AT + 3600000).toISOString(),
      },
    },
    {
      id: 'reviews:primary',
      kind: 'quota',
      scope: 'account',
      bucketId: 'reviews',
      windowId: 'primary',
      usedPercent: 0,
      remainingPercent: 100,
      window: {
        durationSeconds: 3600,
        resetsAt: new Date(RESET_AT).toISOString(),
      },
    },
  ]);
});

test('preserves usedPercent exactly and derives remainingPercent only in the inclusive range 0..100', () => {
  const result = normalizeRateLimitsResponse({
    rateLimitsByLimitId: {
      below: {primary: windowLimit(-1, null, null)},
      above: {primary: windowLimit(101, null, null)},
      fractional: {primary: windowLimit(12.25, null, null)},
      absent: {primary: {windowDurationMins: 0}},
    },
  }, FETCHED_AT);

  assert.deepEqual(result.metrics.map(({bucketId, usedPercent, remainingPercent}) => ({
    bucketId, usedPercent, remainingPercent,
  })), [
    {bucketId: 'below', usedPercent: -1, remainingPercent: undefined},
    {bucketId: 'above', usedPercent: 101, remainingPercent: undefined},
    {bucketId: 'fractional', usedPercent: 12.25, remainingPercent: 87.75},
    {bucketId: 'absent', usedPercent: undefined, remainingPercent: undefined},
  ]);
  assert.equal('durationSeconds' in result.metrics[3].window, false);
  assert.equal('resetsAt' in result.metrics[3].window, false);
});

test('omits null and absent buckets and windows instead of fabricating zero metrics', () => {
  const result = normalizeRateLimitsResponse({
    rateLimitsByLimitId: {
      codex: {
        primary: null,
        secondary: {},
      },
      nullBucket: null,
      emptyBucket: {},
    },
  }, FETCHED_AT);

  assert.equal(result.metrics.length, 0);
});

test('uses the legacy rateLimits shape when rateLimitsByLimitId is absent', () => {
  const result = normalizeRateLimitsResponse({
    rateLimits: {
      primary: windowLimit(40, 300, RESET_AT / 1000),
      secondary: windowLimit(80, 10080, null),
    },
  }, FETCHED_AT);

  assert.deepEqual(result.metrics, [
    {
      id: 'default:primary',
      kind: 'quota',
      scope: 'account',
      bucketId: 'default',
      windowId: 'primary',
      usedPercent: 40,
      remainingPercent: 60,
      window: {
        durationSeconds: 18000,
        resetsAt: new Date(RESET_AT).toISOString(),
      },
    },
    {
      id: 'default:secondary',
      kind: 'quota',
      scope: 'account',
      bucketId: 'default',
      windowId: 'secondary',
      usedPercent: 80,
      remainingPercent: 20,
      window: {durationSeconds: 604800},
    },
  ]);
});

test('does not fall back to legacy data when the bucket map is present but empty', () => {
  const result = normalizeRateLimitsResponse({
    rateLimitsByLimitId: {},
    rateLimits: {primary: windowLimit(7, 5, RESET_AT / 1000)},
  }, FETCHED_AT);

  assert.deepEqual(result.metrics, []);
});

test('parses a JSONL object', () => {
  assert.deepEqual(parseJsonLine('{"id":3,"result":{"ok":true}}'), {
    id: 3,
    result: {ok: true},
  });
});

test('rejects malformed JSON with a typed error', () => {
  assert.throws(
    () => parseJsonLine('{"id":'),
    {name: 'InvalidJsonLineError'},
  );
});

test('rejects non-object JSON-RPC lines with a typed error', () => {
  for (const line of ['null', 'false', '"message"', '[]']) {
    assert.throws(
      () => parseJsonLine(line),
      {name: 'InvalidJsonLineError'},
      `expected ${line} to be rejected`,
    );
  }
});

test('enforces the JSONL maximum by UTF-8 byte count and accepts the exact limit', () => {
  assert.deepEqual(parseJsonLine('{"a":1}', 7), {a: 1});
  assert.throws(
    () => parseJsonLine('{"a":1} ', 7),
    {name: 'OversizedJsonLineError'},
  );
  assert.throws(
    () => parseJsonLine('"éé"', 5),
    {name: 'OversizedJsonLineError'},
    'two-byte UTF-8 characters count by bytes, not UTF-16 code units',
  );
});

test('uses 65536 bytes as the default JSONL maximum', () => {
  assert.throws(
    () => parseJsonLine(`{"payload":"${'x'.repeat(65536)}"}`),
    {name: 'OversizedJsonLineError'},
  );
});
