import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CodexAppServerClient,
  CodexAuthRequiredError,
  CodexRpcError,
  CodexUnsupportedAccountError,
} from '../extension/app-server-client.js';

function jsonLine(message) {
  return JSON.stringify(message);
}

function makeTransport(lines) {
  const writes = [];
  let starts = 0;
  let closes = 0;

  return {
    writes,
    get starts() { return starts; },
    get closes() { return closes; },
    transport: {
      async start() { starts++; },
      async readLine() { return lines.length ? lines.shift() : null; },
      async writeLine(message) { writes.push(message); },
      async close() { closes++; },
    },
  };
}

function initializeLines(result = {userAgent: 'codex-test'}) {
  return [
    jsonLine({jsonrpc: '2.0', method: 'server/notification', params: {ready: true}}),
    jsonLine({jsonrpc: '2.0', id: 101, result: {ignored: true}}),
    jsonLine({jsonrpc: '2.0', id: 1, result}),
  ];
}

function accountLine(account = {type: 'chatgpt', planType: 'plus'}) {
  return jsonLine({jsonrpc: '2.0', id: 2, result: {account}});
}

function writesAsPairs(writes) {
  return writes.map(({id, method}) => ({id, method}));
}

test('handshakes, reads a ChatGPT account without refreshing its token, then normalizes quota', async () => {
  const rateLimits = {
    rateLimitsByLimitId: {
      codex: {primary: {usedPercent: 34, windowDurationMins: 300}},
    },
  };
  const accountEmail = 'private-account@example.test';
  const fake = makeTransport([
    ...initializeLines(),
    accountLine({type: 'chatgpt', planType: 'plus', email: accountEmail}),
    jsonLine({jsonrpc: '2.0', id: 3, result: rateLimits}),
  ]);
  const client = new CodexAppServerClient(fake.transport);
  const fetchedAtMs = Date.UTC(2026, 8, 27, 12, 34, 56);

  const snapshot = await client.readRateLimits(fetchedAtMs);

  assert.equal(fake.starts, 1);
  assert.equal(snapshot.providerId, 'openai');
  assert.equal(snapshot.productId, 'codex-chatgpt');
  assert.equal(snapshot.status, 'ok');
  assert.equal(snapshot.fetchedAt, new Date(fetchedAtMs).toISOString());
  assert.equal(snapshot.planType, 'plus');
  assert.equal(JSON.stringify(snapshot).includes(accountEmail), false);
  assert.equal(Object.hasOwn(snapshot, 'email'), false);
  assert.equal(snapshot.metrics[0].usedPercent, 34);
  assert.equal(snapshot.metrics[0].remainingPercent, 66);
  assert.equal(snapshot.metrics[0].bucketId, 'codex');
  assert.equal(snapshot.metrics[0].windowId, 'primary');
  assert.equal(snapshot.metrics[0].window.durationSeconds, 18000);
  assert.deepEqual(writesAsPairs(fake.writes), [
    {id: 1, method: 'initialize'},
    {id: undefined, method: 'initialized'},
    {id: 2, method: 'account/read'},
    {id: 3, method: 'account/rateLimits/read'},
  ]);
  assert.deepEqual(fake.writes[0].params.clientInfo, {
    name: 'agnome_top',
    version: '0.1.0',
  });
  assert.deepEqual(fake.writes[1], {method: 'initialized', params: {}});
  assert.deepEqual(fake.writes[2], {
    id: 2,
    method: 'account/read',
    params: {refreshToken: false},
  });
  assert.deepEqual(fake.writes[3], {
    id: 3,
    method: 'account/rateLimits/read',
    params: {},
  });
  assert.equal(fake.closes, 1);
});

test('correlates all request ids and ignores notifications between responses', async () => {
  const result = {rateLimits: {primary: {usedPercent: 12}}};
  const fake = makeTransport([
    jsonLine({jsonrpc: '2.0', method: 'server/notification', params: {ready: true}}),
    jsonLine({jsonrpc: '2.0', id: 8, result: {wrong: 'initialize'}}),
    jsonLine({jsonrpc: '2.0', id: 1, result: {initialized: true}}),
    jsonLine({jsonrpc: '2.0', method: 'account/updated', params: {new: true}}),
    jsonLine({jsonrpc: '2.0', id: 9, result: {wrong: 'account'}}),
    accountLine(),
    jsonLine({jsonrpc: '2.0', method: 'account/rateLimits/updated', params: {new: false}}),
    jsonLine({jsonrpc: '2.0', id: 10, result: {wrong: 'rate limits'}}),
    jsonLine({jsonrpc: '2.0', id: 3, result}),
  ]);
  const client = new CodexAppServerClient(fake.transport);

  const snapshot = await client.readRateLimits(Date.UTC(2026, 8, 27));

  assert.equal(snapshot.status, 'ok');
  assert.equal(snapshot.metrics[0].usedPercent, 12);
  assert.equal(snapshot.metrics[0].remainingPercent, 88);
  assert.equal(snapshot.metrics[0].bucketId, 'default');
  assert.deepEqual(writesAsPairs(fake.writes), [
    {id: 1, method: 'initialize'},
    {id: undefined, method: 'initialized'},
    {id: 2, method: 'account/read'},
    {id: 3, method: 'account/rateLimits/read'},
  ]);
  assert.equal(fake.closes, 1);
});

test('requires an authenticated account and closes transport when account is null', async () => {
  const fake = makeTransport([
    ...initializeLines(),
    accountLine(null),
  ]);
  const client = new CodexAppServerClient(fake.transport);

  await assert.rejects(client.readRateLimits(), error => error instanceof CodexAuthRequiredError);
  assert.equal(fake.writes.some(({method}) => method === 'account/rateLimits/read'), false);
  assert.equal(fake.closes, 1);
});

test('rejects non-ChatGPT accounts and closes transport', async () => {
  const fake = makeTransport([
    ...initializeLines(),
    accountLine({type: 'api', planType: null}),
  ]);
  const client = new CodexAppServerClient(fake.transport);

  await assert.rejects(client.readRateLimits(), error => error instanceof CodexUnsupportedAccountError);
  assert.equal(fake.writes.some(({method}) => method === 'account/rateLimits/read'), false);
  assert.equal(fake.closes, 1);
});

test('throws typed CodexRpcError without leaking an RPC error message', async () => {
  const secretDiagnostic = 'private server detail: session-token-fragment';
  const fake = makeTransport([
    ...initializeLines(),
    jsonLine({
      jsonrpc: '2.0',
      id: 2,
      error: {code: -32000, message: secretDiagnostic, data: {detail: secretDiagnostic}},
    }),
  ]);
  const client = new CodexAppServerClient(fake.transport);

  await assert.rejects(client.readRateLimits(), error => {
    assert.ok(error instanceof CodexRpcError);
    assert.doesNotMatch(error.message, /private server detail|session-token-fragment/);
    assert.equal(fake.closes, 1);
    return true;
  });
});

test('rejects malformed JSONL and still closes transport', async () => {
  const fake = makeTransport([
    ...initializeLines(),
    accountLine(),
    '{"jsonrpc":"2.0","id":3,"result":',
  ]);
  const client = new CodexAppServerClient(fake.transport);

  await assert.rejects(client.readRateLimits(), {name: 'InvalidJsonLineError'});
  assert.equal(fake.closes, 1);
});

test('rejects premature EOF while awaiting a response and closes transport', async () => {
  const fake = makeTransport([
    jsonLine({jsonrpc: '2.0', id: 1, result: {initialized: true}}),
  ]);
  const client = new CodexAppServerClient(fake.transport);

  await assert.rejects(client.readRateLimits());
  assert.deepEqual(writesAsPairs(fake.writes), [
    {id: 1, method: 'initialize'},
    {id: undefined, method: 'initialized'},
    {id: 2, method: 'account/read'},
  ]);
  assert.equal(fake.closes, 1);
});

test('closes transport on startup or write failure', async () => {
  for (const failingMethod of ['start', 'writeLine']) {
    let closes = 0;
    const transport = {
      async start() {
        if (failingMethod === 'start') throw new Error('start failed');
      },
      async readLine() { return null; },
      async writeLine() {
        if (failingMethod === 'writeLine') throw new Error('write failed');
      },
      async close() { closes++; },
    };

    await assert.rejects(new CodexAppServerClient(transport).readRateLimits());
    assert.equal(closes, 1, `transport must close after ${failingMethod} failure`);
  }
});
