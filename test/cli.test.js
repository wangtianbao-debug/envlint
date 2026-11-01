import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lintDirectory, parseArgs, run } from '../src/cli.js';

function capture() {
  const out = [];
  const err = [];
  return { io: { stdout: { write: (s) => out.push(s), isTTY: false }, error: (s) => err.push(s) }, out: () => out.join(''), err: () => err.join('') };
}

function workspace(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'envlint-'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

test('parses flags and the directory', () => {
  const { opts } = parseArgs(['fixtures', '--strict', '--json']);
  assert.equal(opts.dir, 'fixtures');
  assert.equal(opts.strict, true);
  assert.equal(opts.json, true);

  assert.equal(parseArgs(['--file', '.env.local']).opts.file, '.env.local');
  assert.equal(parseArgs([]).opts.example, '.env.example');
});

test('rejects unknown options and missing values', () => {
  for (const argv of [['--nope'], ['--file'], ['--file', '--strict'], ['a', 'b']]) {
    assert.equal(run(argv, capture().io), 2, `argv: ${argv.join(' ')}`);
  }
});

test('help and version succeed', () => {
  const help = capture();
  assert.equal(run(['--help'], help.io), 0);
  assert.match(help.out(), /envlint — catch the mistakes/);

  const version = capture();
  assert.equal(run(['-v'], version.io), 0);
  assert.match(version.out().trim(), /^\d+\.\d+\.\d+$/);
});

test('a clean pair exits 0', () => {
  const dir = workspace({ '.env': 'A=1\nB=2\n', '.env.example': 'A=\nB=\n', '.gitignore': '.env\n' });
  const c = capture();
  assert.equal(run([dir], c.io), 0);
  assert.match(c.out(), /clean/);
});

test('duplicate keys exit 1 and point at the line', () => {
  const dir = workspace({ '.env': 'A=1\nA=2\n', '.env.example': 'A=\n' });
  const c = capture();
  assert.equal(run([dir], c.io), 1);
  assert.match(c.out(), /duplicate-key/);
  assert.match(c.out(), /2\s+error/);
});

test('warnings need --strict to fail', () => {
  const dir = workspace({ '.env': 'A=\n', '.env.example': 'A=\n' });
  assert.equal(run([dir], capture().io), 0);
  assert.equal(run([dir, '--strict'], capture().io), 1);
});

test('drift between .env and .env.example is reported', () => {
  const dir = workspace({ '.env': 'A=1\nEXTRA=2\n', '.env.example': 'A=\nMISSING=\n' });
  const c = capture();
  assert.equal(run([dir], c.io), 0);
  assert.match(c.out(), /undocumented-key/);
  assert.match(c.out(), /missing-from-env/);
});

test('a missing .env exits 2 with a readable message', () => {
  const dir = workspace({ '.env.example': 'A=\n' });
  const c = capture();
  assert.equal(run([dir], c.io), 2);
  assert.match(c.err(), /no \.env/);
});

test('--json mirrors the text report', () => {
  const dir = workspace({ '.env': 'A=1\nA=2\n', '.env.example': 'A=\n' });
  const c = capture();
  assert.equal(run([dir, '--json'], c.io), 1);
  const parsed = JSON.parse(c.out());
  assert.equal(parsed.counts.error, 1);
  assert.ok(parsed.diagnostics.some((d) => d.code === 'duplicate-key'));
});

test('--all also lints .env.local', () => {
  const dir = workspace({ '.env': 'A=1\n', '.env.example': 'A=\n', '.env.local': 'A=1\nA=2\n' });
  const withoutAll = capture();
  assert.equal(run([dir], withoutAll.io), 0);
  const withAll = capture();
  assert.equal(run([dir, '--all'], withAll.io), 1);
  assert.match(withAll.out(), /\.env\.local/);
});

test('an unignored .env is called out, an ignored one is not', () => {
  const bare = workspace({ '.env': 'A=1\n', '.env.example': 'A=\n' });
  const warn = capture();
  assert.equal(run([bare], warn.io), 0);
  assert.match(warn.out(), /env-not-ignored/);

  const covered = workspace({ '.env': 'A=1\n', '.env.example': 'A=\n', '.gitignore': 'node_modules\n.env\n' });
  const calm = capture();
  assert.equal(run([covered], calm.io), 0);
  assert.doesNotMatch(calm.out(), /env-not-ignored/);
});

test('lintDirectory can be called directly', () => {
  const dir = workspace({ '.env': 'A=1\nA=2\n', '.env.example': 'A=\n' });
  const { files, diagnostics } = lintDirectory(dir);
  assert.deepEqual(files.sort(), ['.env', '.env.example']);
  assert.ok(diagnostics.some((d) => d.code === 'duplicate-key'));
});

test('an injected linter keeps the CLI testable', () => {
  const c = capture();
  const deps = { lintDirectory: () => ({ files: ['.env'], diagnostics: [{ file: '.env', line: 1, severity: 'error', code: 'x', message: 'boom' }] }) };
  assert.equal(run([], c.io, deps), 1);
  assert.match(c.out(), /boom/);
});
