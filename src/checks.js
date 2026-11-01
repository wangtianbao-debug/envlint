import { parseDotenv } from './dotenv.js';

export const SEVERITY_ORDER = { error: 0, warn: 1, note: 2 };

const SECRET_PATTERNS = [
  /^gh[pousr]_[A-Za-z0-9]{20,}$/,
  /^github_pat_[A-Za-z0-9_]{20,}$/,
  /^sk-[A-Za-z0-9-]{16,}$/,
  /^xox[baprs]-[A-Za-z0-9-]{10,}$/,
  /^AKIA[0-9A-Z]{16}$/,
  /^AIza[0-9A-Za-z_-]{35}$/,
  /^-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, // JWT
];

/** Does this look like a credential someone pasted instead of a placeholder? */
export function looksSecret(value) {
  const text = String(value).trim();
  if (!text || text.length < 12) return false;
  if (SECRET_PATTERNS.some((re) => re.test(text))) return true;
  // Long random-looking tokens: at least 32 chars, mostly base64/hex.
  if (/^[A-Za-z0-9+/=_-]{32,}$/.test(text) && /[0-9]/.test(text) && /[A-Za-z]/.test(text)) return true;
  return false;
}

const PLACEHOLDER = /^(<.*>|\$\{?[A-Z_]+\}?|changeme|change-me|your[-_ ].*|xxx+|todo|example|placeholder|dummy|redacted|\*+)$/i;

export function isPlaceholder(value) {
  const text = String(value).trim();
  return text === '' || PLACEHOLDER.test(text);
}

/**
 * Lint one parsed file.
 *
 * @param {{file: string, parsed: object, kind?: 'env'|'example'}} input
 */
export function lintFile({ parsed, kind = 'env' }) {
  const out = [];
  const at = (line) => ({ file: parsed.file, line });

  for (const issue of parsed.issues) {
    const severity = issue.code === 'missing-value' ? 'warn' : 'error';
    out.push({ ...at(issue.line), code: issue.code, severity, message: issue.message });
  }

  const seen = new Map();
  for (const entry of parsed.entries) {
    const where = at(entry.line);

    if (seen.has(entry.key)) {
      out.push({
        ...where,
        code: 'duplicate-key',
        severity: 'error',
        message: `${entry.key} is already defined on line ${seen.get(entry.key)}; the later value wins`,
      });
    } else {
      seen.set(entry.key, entry.line);
    }

    if (entry.value === '' && kind === 'env') {
      out.push({ ...where, code: 'empty-value', severity: 'warn', message: `${entry.key} is empty` });
    }

    if (entry.spaceAfterEquals) {
      out.push({
        ...where,
        code: 'space-after-equals',
        severity: 'warn',
        message: `${entry.key} has whitespace after "=", which most parsers keep as part of the value`,
      });
    }

    if (entry.trailingSpace) {
      out.push({ ...where, code: 'trailing-space', severity: 'note', message: `${entry.key} has trailing whitespace in its value` });
    }

    if (kind === 'example' && looksSecret(entry.value)) {
      out.push({
        ...where,
        code: 'secret-in-example',
        severity: 'error',
        message: `${entry.key} in ${parsed.file} looks like a real credential; examples must use placeholders`,
      });
    } else if (kind === 'env' && looksSecret(entry.value)) {
      out.push({
        ...where,
        code: 'possible-secret',
        severity: 'warn',
        message: `${entry.key} looks like a live credential; keep this file out of git`,
      });
    }
  }

  if (parsed.bom) {
    out.push({ ...at(1), code: 'bom', severity: 'warn', message: 'file starts with a UTF-8 byte order mark, which breaks the first key' });
  }
  if (parsed.newline === 'crlf') {
    out.push({ ...at(1), code: 'crlf', severity: 'note', message: 'CRLF line endings; dotenv tools usually cope, editors may not' });
  }

  return out;
}

/**
 * Compare the keys of two files: `reference` documents what `target` should set.
 *
 * @returns {Array} diagnostics
 */
export function lintDrift(reference, target) {
  const out = [];
  const targetKeys = new Map(target.entries.map((e) => [e.key, e]));
  const referenceKeys = new Map(reference.entries.map((e) => [e.key, e]));

  for (const entry of reference.entries) {
    if (!targetKeys.has(entry.key)) {
      out.push({
        file: target.file,
        line: 1,
        code: 'missing-from-env',
        severity: 'note',
        message: `${entry.key} is documented in ${reference.file} but not set in ${target.file}`,
      });
    }
  }

  for (const entry of target.entries) {
    if (!referenceKeys.has(entry.key)) {
      out.push({
        file: target.file,
        line: entry.line,
        code: 'undocumented-key',
        severity: 'warn',
        message: `${entry.key} is set but not documented in ${reference.file}`,
      });
    }
  }

  return out;
}

export function sortDiagnostics(diagnostics) {
  return [...diagnostics].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.code.localeCompare(b.code),
  );
}

export function countBy(diagnostics) {
  const counts = { error: 0, warn: 0, note: 0 };
  for (const d of diagnostics) counts[d.severity] = (counts[d.severity] ?? 0) + 1;
  return counts;
}

/** Convenience: parse then lint. */
export function lintText(text, { file = '.env', kind = file.includes('example') ? 'example' : 'env' } = {}) {
  const parsed = parseDotenv(text, { file });
  return lintFile({ parsed, kind });
}

/** Does a .gitignore body exclude .env in this directory? */
export function gitignoreCoversEnv(text) {
  return String(text)
    .split(/\r?\n/)
    .some((line) => {
      const pattern = line.trim();
      if (!pattern || pattern.startsWith('#') || pattern.startsWith('!')) return false;
      const clean = pattern.replace(/^\/+/, '').replace(/\/$/, '');
      if (clean === '.env.example') return false;
      return clean === '.env' || clean === '.env*' || clean === '*.env' || clean === '**/.env' || /^\.env(\..+)?$/.test(clean);
    });
}
