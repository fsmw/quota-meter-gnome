import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const RUNNER = path.join(path.dirname(new URL(import.meta.url).pathname), 'gjs-session-usage.mjs');

function tokenEvent(input, output, total) {
  return JSON.stringify({
    type: 'event_msg',
    payload: {type: 'token_count', info: {last_token_usage: {
      input_tokens: input, output_tokens: output, total_tokens: total,
    }}},
  }) + '\n';
}

test('Gio provider selects the latest three sessions and reads only appended JSONL bytes', t => {
  const home = mkdtempSync(path.join(tmpdir(), 'agnome-top-sessions-'));
  t.after(() => rmSync(home, {recursive: true, force: true}));
  const sessions = path.join(home, 'sessions', '2026', '09', '29');
  mkdirSync(sessions, {recursive: true});
  const paths = ['a.jsonl', 'b.jsonl', 'c.jsonl', 'old.jsonl'].map(name => path.join(sessions, name));
  const values = [[2, 1, 3], [3, 2, 5], [4, 2, 6], [90, 90, 180]];
  paths.forEach((file, index) => {
    writeFileSync(file, tokenEvent(...values[index]));
    const timestamp = Math.floor(Date.now() / 1000) - index * 10;
    utimesSync(file, timestamp, timestamp);
  });

  const result = spawnSync('gjs', ['-m', RUNNER], {
    encoding: 'utf8',
    timeout: 12000,
    env: {...process.env, CODEX_HOME: home, USAGE_TEST_APPEND_PATH: paths[1]},
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  const {first, second} = JSON.parse(result.stdout.trim());
  assert.equal(first.sessionCount, 3, `${JSON.stringify(first)} ${result.stderr}`);
  assert.equal(first.latest.tokens.total, 3);
  assert.equal(first.total.total, 14);
  assert.equal(second.total.total, 19);
  assert.equal(second.total.inputTotal, 13);
  assert.equal(Object.hasOwn(second.total, 'input'), false);
  assert.equal(second.total.output, 6);
});

test('Gio provider reports zero, one, or two available sessions without inventing usage', t => {
  const home = mkdtempSync(path.join(tmpdir(), 'agnome-top-short-history-'));
  t.after(() => rmSync(home, {recursive: true, force: true}));
  const sessions = path.join(home, 'sessions');
  mkdirSync(sessions, {recursive: true});

  for (let count = 0; count <= 2; count++) {
    for (const entry of readdirSync(sessions))
      rmSync(path.join(sessions, entry), {recursive: true, force: true});
    for (let index = 0; index < count; index++)
      writeFileSync(path.join(sessions, `s${index}.jsonl`), tokenEvent(index + 1, 2, index + 3));

    const result = spawnSync('gjs', ['-m', RUNNER], {
      encoding: 'utf8',
      timeout: 12000,
      env: {...process.env, CODEX_HOME: home},
    });
    assert.equal(result.status, 0, result.stderr);
    const {first} = JSON.parse(result.stdout.trim());
    assert.equal(first.sessionCount, count);
    assert.equal(first.status, count === 0 ? 'unavailable' : 'ok');
    assert.equal(first.total.total ?? 0, count === 0 ? 0 : count === 1 ? 3 : 7);
  }
});
