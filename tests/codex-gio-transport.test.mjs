import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const GJS_INTEGRATION_RUNNER = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  'gjs-codex-integration.mjs',
);

test('Gio stdio transport completes JSONL handshake and reaps Codex child', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'agnome-top-codex-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const markerPath = path.join(directory, 'stdin-closed');
  const codexPath = path.join(directory, 'codex');
  const fixture = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const rl = readline.createInterface({input: process.stdin});
process.stdin.on('end', () => fs.writeFileSync(${JSON.stringify(markerPath)}, 'closed'));
rl.on('line', line => {
  const request = JSON.parse(line);
  let result;
  if (request.method === 'initialize') result = {serverInfo: {name: 'fixture'}};
  if (request.method === 'account/read') result = {
    account: {type: 'chatgpt', planType: 'pro', email: 'private@example.invalid'},
    requiresOpenaiAuth: true,
  };
  if (request.method === 'account/rateLimits/read') result = {
    rateLimitsByLimitId: {
      codex: {primary: {usedPercent: 25, windowDurationMins: 300, resetsAt: 1790000000}},
    },
  };
  if (request.id !== undefined) process.stdout.write(JSON.stringify({id: request.id, result}) + '\\n');
});
`;
  writeFileSync(codexPath, fixture, {mode: 0o755});

  const result = spawnSync('gjs', ['-m', GJS_INTEGRATION_RUNNER], {
    encoding: 'utf8',
    timeout: 12000,
    env: {
      HOME: process.env.HOME,
      PATH: `${directory}:${process.env.PATH}`,
      LANG: 'C.UTF-8',
    },
  });

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(markerPath, 'utf8'), 'closed');
  assert.doesNotMatch(result.stdout, /private@example/);
  const snapshot = JSON.parse(result.stdout.trim());
  assert.equal(snapshot.status, 'ok');
  assert.equal(snapshot.planType, 'pro');
  assert.equal(snapshot.metrics[0].usedPercent, 25);
  assert.equal(snapshot.metrics[0].remainingPercent, 75);
});
