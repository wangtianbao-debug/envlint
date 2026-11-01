const ANSI = { reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m', red: '\x1b[31m', yellow: '\x1b[33m', blue: '\x1b[34m', green: '\x1b[32m' };

export function makeColors(enabled) {
  const wrap = (code) => (text) => (enabled ? `${code}${text}${ANSI.reset}` : String(text));
  return {
    dim: wrap(ANSI.dim),
    bold: wrap(ANSI.bold),
    red: wrap(ANSI.red),
    yellow: wrap(ANSI.yellow),
    blue: wrap(ANSI.blue),
    green: wrap(ANSI.green),
  };
}

const LABEL = { error: 'error', warn: 'warn ', note: 'note ' };

function severityText(color, severity) {
  if (severity === 'error') return color.red(LABEL.error);
  if (severity === 'warn') return color.yellow(LABEL.warn);
  return color.blue(LABEL.note);
}

/** Group diagnostics by file, keeping the caller's order inside a file. */
export function groupByFile(diagnostics) {
  const groups = new Map();
  for (const d of diagnostics) {
    if (!groups.has(d.file)) groups.set(d.file, []);
    groups.get(d.file).push(d);
  }
  return groups;
}

export function formatDiagnostics(diagnostics, { color = makeColors(false), files = [] } = {}) {
  if (!diagnostics.length) return `${color.green('ok')}  ${files.length ? `${files.length} file${files.length === 1 ? '' : 's'} clean` : 'no problems found'}\n`;

  const lines = [];
  const groups = groupByFile(diagnostics);
  const width = Math.max(...[...groups.values()].flat().map((d) => String(d.line).length));
  const codeWidth = Math.max(...diagnostics.map((d) => d.code.length));

  for (const [file, items] of groups) {
    lines.push(color.bold(file));
    for (const d of items) {
      lines.push(`  ${String(d.line).padStart(width)}  ${severityText(color, d.severity)}  ${color.dim(d.code.padEnd(codeWidth))}  ${d.message}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

export function summarize(diagnostics) {
  const counts = { error: 0, warn: 0, note: 0 };
  for (const d of diagnostics) counts[d.severity] = (counts[d.severity] ?? 0) + 1;
  const total = counts.error + counts.warn + counts.note;
  if (!total) return 'clean';
  const parts = [];
  if (counts.error) parts.push(`${counts.error} error${counts.error === 1 ? '' : 's'}`);
  if (counts.warn) parts.push(`${counts.warn} warning${counts.warn === 1 ? '' : 's'}`);
  if (counts.note) parts.push(`${counts.note} note${counts.note === 1 ? '' : 's'}`);
  return `${total} problem${total === 1 ? '' : 's'} (${parts.join(', ')})`;
}

export function formatJson(diagnostics, { files = [], strict = false } = {}) {
  const counts = { error: 0, warn: 0, note: 0 };
  for (const d of diagnostics) counts[d.severity]++;
  return `${JSON.stringify(
    {
      files,
      strict,
      counts,
      diagnostics: diagnostics.map((d) => ({ file: d.file, line: d.line, severity: d.severity, code: d.code, message: d.message })),
    },
    null,
    2,
  )}\n`;
}
