import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDiagnostics, formatJson, groupByFile, makeColors, summarize } from '../src/report.js';

const plain = makeColors(false);

const SAMPLE = [
  { file: '.env', line: 3, severity: 'error', code: 'duplicate-key', message: 'A is already defined on line 1' },
  { file: '.env', line: 5, severity: 'warn', code: 'empty-value', message: 'B is empty' },
  { file: '.env.example', line: 1, severity: 'note', code: 'missing-from-env', message: 'C is documented but not set' },
];

test('colours are opt-in', () => {
  assert.equal(makeColors(false).red('x'), 'x');
  assert.match(makeColors(true).red('x'), /\x1b\[31mx/);
});

test('diagnostics are grouped by file with line and code', () => {
  const text = formatDiagnostics(SAMPLE, { color: plain, files: ['.env', '.env.example'] });
  assert.match(text, /^\.env$/m);
  assert.match(text, /^\s+3\s+error\s+duplicate-key\s+A is already defined/m);
  assert.match(text, /^\s+5\s+warn\s+empty-value/m);
  assert.match(text, /^\.env\.example$/m);
  assert.match(text, /^\s+1\s+note\s+missing-from-env/m);
});

test('a clean run says so without listing anything', () => {
  assert.equal(formatDiagnostics([], { color: plain, files: ['.env'] }), 'ok  1 file clean\n');
  assert.equal(formatDiagnostics([], { color: plain }), 'ok  no problems found\n');
});

test('summarize counts by severity with English plurals', () => {
  assert.equal(summarize([]), 'clean');
  assert.equal(summarize(SAMPLE), '3 problems (1 error, 1 warning, 1 note)');
  assert.equal(summarize([{ severity: 'error' }]), '1 problem (1 error)');
});

test('groupByFile keeps insertion order and contents', () => {
  const groups = groupByFile(SAMPLE);
  assert.deepEqual([...groups.keys()], ['.env', '.env.example']);
  assert.equal(groups.get('.env').length, 2);
});

test('json output carries counts and exits data', () => {
  const parsed = JSON.parse(formatJson(SAMPLE, { files: ['.env'], strict: true }));
  assert.equal(parsed.strict, true);
  assert.deepEqual(parsed.counts, { error: 1, warn: 1, note: 1 });
  assert.deepEqual(parsed.diagnostics[0], SAMPLE[0]);
});
