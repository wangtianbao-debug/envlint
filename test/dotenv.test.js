import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDotenv } from '../src/dotenv.js';

const entry = (parsed, key) => parsed.entries.find((e) => e.key === key);

test('parses plain keys, values and comments', () => {
  const parsed = parseDotenv(`
# database
DATABASE_URL=postgres://localhost/dev
PORT=3000

EMPTY=
`);
  assert.equal(parsed.entries.length, 3);
  assert.deepEqual(
    parsed.entries.map((e) => [e.key, e.value, e.line]),
    [
      ['DATABASE_URL', 'postgres://localhost/dev', 3],
      ['PORT', '3000', 4],
      ['EMPTY', '', 6],
    ],
  );
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.newline, 'lf');
  assert.equal(parsed.bom, false);
});

test('double quotes keep hashes and honour escapes', () => {
  const parsed = parseDotenv('PASSWORD="p@ss#word"\nQUOTED="say \\"hi\\""\n');
  assert.equal(entry(parsed, 'PASSWORD').value, 'p@ss#word');
  assert.equal(entry(parsed, 'PASSWORD').quoted, '"');
  assert.equal(entry(parsed, 'QUOTED').value, 'say "hi"');
});

test('single quotes do not interpret escapes', () => {
  const parsed = parseDotenv("RAW='C:\\path\\n#hash'\n");
  assert.equal(entry(parsed, 'RAW').value, 'C:\\path\\n#hash');
  assert.equal(entry(parsed, 'RAW').quoted, "'");
});

test('a hash after whitespace starts a comment, a glued hash does not', () => {
  const parsed = parseDotenv('A=hello # trailing\nB=pa#ss\n');
  assert.equal(entry(parsed, 'A').value, 'hello');
  assert.equal(entry(parsed, 'A').comment, 'trailing');
  assert.equal(entry(parsed, 'B').value, 'pa#ss');
  assert.equal(entry(parsed, 'B').comment, '');
});

test('comments after quoted values are separated', () => {
  const parsed = parseDotenv('KEY="value" # why\n');
  assert.equal(entry(parsed, 'KEY').value, 'value');
  assert.equal(entry(parsed, 'KEY').comment, 'why');
});

test('export prefix is allowed and recorded', () => {
  const parsed = parseDotenv('export TOKEN=abc\n');
  assert.equal(entry(parsed, 'TOKEN').value, 'abc');
  assert.equal(entry(parsed, 'TOKEN').export, true);
});

test('whitespace around the equals sign is recorded, not silently eaten', () => {
  const parsed = parseDotenv('SPACED = value\nGLUED=value\n');
  assert.equal(entry(parsed, 'SPACED').key, 'SPACED');
  assert.equal(entry(parsed, 'SPACED').spaceAfterEquals, true);
  assert.equal(entry(parsed, 'GLUED').spaceAfterEquals, false);
});

test('bare keys, invalid names and unterminated quotes become issues', () => {
  const parsed = parseDotenv('JUST_A_KEY\n1BAD=x\nBROKEN="never ends\n');
  assert.deepEqual(
    parsed.issues.map((i) => [i.line, i.code]),
    [
      [1, 'missing-value'],
      [2, 'bad-key'],
      [3, 'unterminated-quote'],
    ],
  );
  assert.equal(parsed.entries.length, 0);
});

test('a line that is not an assignment is reported', () => {
  const parsed = parseDotenv('this is not a key value pair\n');
  assert.equal(parsed.issues[0].code, 'bad-line');
});

test('detects a BOM and CRLF endings', () => {
  const parsed = parseDotenv('\ufeffA=1\r\nB=2\r\n');
  assert.equal(parsed.bom, true);
  assert.equal(parsed.newline, 'crlf');
  assert.equal(parsed.entries[0].key, 'A', 'the BOM does not corrupt the first key');
  assert.equal(parsed.entries[0].value, '1');
});

test('trailing whitespace in a value is recorded', () => {
  const parsed = parseDotenv('A=value   \n');
  assert.equal(entry(parsed, 'A').trailingSpace, true);
});

test('keys allow dots and dashes, and duplicates are preserved for the checker', () => {
  const parsed = parseDotenv('a.b=1\nA-B=2\nDUP=1\nDUP=2\n');
  assert.deepEqual(
    parsed.entries.map((e) => e.key),
    ['a.b', 'A-B', 'DUP', 'DUP'],
  );
});
