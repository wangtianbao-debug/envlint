/**
 * A small dotenv parser that keeps line numbers, quoting and comments.
 *
 * It follows the widely used dotenv rules rather than inventing new ones, so
 * `envlint` flags what your runtime will actually see:
 *
 *   KEY=value            plain
 *   KEY="value # not a comment"
 *   KEY='value'          single quotes: no escapes
 *   KEY=value # comment  a hash after whitespace starts a comment
 *   export KEY=value     the export prefix is allowed
 */

const KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export function parseDotenv(text, { file = '.env' } = {}) {
  const source = String(text);
  const bom = source.charCodeAt(0) === 0xfeff;
  const body = bom ? source.slice(1) : source;
  const newline = body.includes('\r\n') ? 'crlf' : 'lf';

  const entries = [];
  const issues = [];
  const lines = body.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const parsed = parseLine(line);
    if (parsed.issue) {
      issues.push({ line: lineNo, code: parsed.issue.code, message: parsed.issue.message, file });
      return;
    }
    entries.push({ ...parsed, line: lineNo, file });
  });

  return { file, bom, newline, entries, issues };
}

function parseLine(line) {
  let rest = line.trimStart();
  let isExport = false;
  if (/^export\s+/.test(rest)) {
    isExport = true;
    rest = rest.replace(/^export\s+/, '');
  }

  const eq = rest.indexOf('=');
  if (eq === -1) {
    const key = rest.trim();
    if (!KEY.test(key)) {
      return { issue: { code: 'bad-line', message: `not a KEY=value line: ${JSON.stringify(line.trim())}` } };
    }
    return { issue: { code: 'missing-value', message: `${key} has no value (write ${key}= to declare it empty)` } };
  }

  const rawKey = rest.slice(0, eq).trim();
  if (!KEY.test(rawKey)) {
    return { issue: { code: 'bad-key', message: `invalid variable name ${JSON.stringify(rawKey)}` } };
  }

  const afterEq = rest.slice(eq + 1);
  const spaceAfterEquals = afterEq.length > 0 && /^\s/.test(afterEq);
  const parsed = unwrap(afterEq);
  if (parsed.unterminated) {
    return { issue: { code: 'unterminated-quote', message: `${rawKey} opens a ${parsed.quoted} quote that never closes` } };
  }

  return {
    key: rawKey,
    value: parsed.value,
    quoted: parsed.quoted,
    comment: parsed.comment,
    export: isExport,
    spaceAfterEquals,
    trailingSpace: parsed.trailingSpace,
  };
}

function unwrap(afterEq) {
  const text = afterEq.replace(/^\s+/, '');

  if (text.startsWith('"') || text.startsWith("'")) {
    const quote = text[0];
    let out = '';
    let i = 1;
    let closed = false;
    while (i < text.length) {
      const ch = text[i];
      if (quote === '"' && ch === '\\' && i + 1 < text.length) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) {
        closed = true;
        i++;
        break;
      }
      out += ch;
      i++;
    }
    if (!closed) return { value: out, quoted: quote, unterminated: true };
    const tail = text.slice(i);
    const comment = /^\s*#/.test(tail) ? tail.replace(/^\s*#\s?/, '') : '';
    return { value: out, quoted: quote, comment, trailingSpace: false };
  }

  // Unquoted: a hash preceded by whitespace starts a comment.
  const commentAt = text.search(/\s#/);
  let value = text;
  let comment = '';
  if (commentAt !== -1) {
    value = text.slice(0, commentAt);
    comment = text.slice(commentAt).replace(/^\s*#\s?/, '');
  }
  const trailingSpace = /\s$/.test(value);
  return { value: value.trimEnd(), quoted: null, comment, trailingSpace };
}
