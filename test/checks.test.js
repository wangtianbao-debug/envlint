import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDotenv } from '../src/dotenv.js';
import { countBy, lintDrift, lintFile, lintText, looksSecret, sortDiagnostics } from '../src/checks.js';

const codes = (list) => list.map((d) => `${d.line}:${d.code}`);

test('duplicate keys are an error that names the first line', () => {
  const found = lintText('A=1\nB=2\nA=3\n', { file: '.env' });
  const dup = found.find((d) => d.code === 'duplicate-key');
  assert.equal(dup.severity, 'error');
  assert.equal(dup.line, 3);
  assert.match(dup.message, /line 1/);
});

test('empty values and spacing are warnings, trailing space is a note', () => {
  const found = lintText('EMPTY=\nSPACED = x\nTAIL=y   \n', { file: '.env' });
  assert.deepEqual(codes(found).sort(), ['1:empty-value', '2:space-after-equals', '3:trailing-space']);
  assert.equal(found.find((d) => d.code === 'empty-value').severity, 'warn');
  assert.equal(found.find((d) => d.code === 'trailing-space').severity, 'note');
});

test('a value that looks like a credential is flagged in .env', () => {
  const found = lintText('GITHUB_TOKEN=ghp_0123456789abcdefghijABCDEFGHIJ012345\n', { file: '.env' });
  assert.ok(found.some((d) => d.code === 'possible-secret' && d.severity === 'warn'));
});

test('the same value in an example file is an error', () => {
  const found = lintText('GITHUB_TOKEN=ghp_0123456789abcdefghijABCDEFGHIJ012345\n', { file: '.env.example', kind: 'example' });
  assert.ok(found.some((d) => d.code === 'secret-in-example' && d.severity === 'error'));
});

test('placeholders are not treated as secrets', () => {
  for (const value of ['<your-token>', '${GITHUB_TOKEN}', 'changeme', 'your-api-key-here', 'xxxx', 'example', '']) {
    assert.equal(looksSecret(value), false, `value: ${value}`);
  }
  for (const value of [
    'ghp_0123456789abcdefghijABCDEFGHIJ012345',
    'sk-proj-abcdefghijklmnopqrstuvwx',
    'AKIAIOSFODNN7EXAMPLE',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    'a9f8e7d6c5b4a39281706f5e4d3c2b1a0f9e8d7c',
  ]) {
    assert.equal(looksSecret(value), true, `value: ${value}`);
  }
});

test('BOM and CRLF are reported once at the top of the file', () => {
  const found = lintText('\ufeffA=1\r\n', { file: '.env' });
  assert.deepEqual(codes(found).sort(), ['1:bom', '1:crlf']);
});

test('parser issues keep their severity mapping', () => {
  const found = lintFile({ parsed: parseDotenv('BROKEN="x\n', { file: '.env' }), kind: 'env' });
  assert.equal(found[0].code, 'unterminated-quote');
  assert.equal(found[0].severity, 'error');
});

test('drift: documented but unset, and set but undocumented', () => {
  const example = parseDotenv('API_URL=\nAPI_KEY=\nLEGACY=\n', { file: '.env.example' });
  const env = parseDotenv('API_URL=http://x\nAPI_KEY=abc\nEXTRA=1\n', { file: '.env' });
  const found = lintDrift(example, env);
  assert.deepEqual(
    found.map((d) => `${d.code}:${d.message.split(' ')[0]}`),
    ['missing-from-env:LEGACY', 'undocumented-key:EXTRA'],
  );
  assert.equal(found[0].severity, 'note');
  assert.equal(found[1].severity, 'warn');
  assert.equal(found[1].line, 3);
});

test('sorting puts files, then lines, then severity', () => {
  const found = sortDiagnostics([
    { file: 'b.env', line: 2, severity: 'warn', code: 'x', message: '' },
    { file: 'a.env', line: 5, severity: 'note', code: 'x', message: '' },
    { file: 'a.env', line: 5, severity: 'error', code: 'x', message: '' },
    { file: 'a.env', line: 1, severity: 'warn', code: 'x', message: '' },
  ]);
  assert.deepEqual(
    found.map((d) => `${d.file}:${d.line}:${d.severity}`),
    ['a.env:1:warn', 'a.env:5:error', 'a.env:5:note', 'b.env:2:warn'],
  );
});

test('countBy totals every severity', () => {
  const counts = countBy([
    { severity: 'error' },
    { severity: 'warn' },
    { severity: 'warn' },
    { severity: 'note' },
  ]);
  assert.deepEqual(counts, { error: 1, warn: 2, note: 1 });
});

test('a clean file produces nothing', () => {
  assert.deepEqual(lintText('A=1\nB=2\n', { file: '.env' }), []);
});
