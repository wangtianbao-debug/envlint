import fs from 'node:fs';
import path from 'node:path';
import { countBy, gitignoreCoversEnv, lintDrift, lintFile, sortDiagnostics } from './checks.js';
import { parseDotenv } from './dotenv.js';
import { formatDiagnostics, formatJson, makeColors, summarize } from './report.js';

const HELP = `envlint — catch the mistakes in your .env before they bite

Usage
  envlint [dir] [options]

  Reads .env (and friends) and reports the problems dotenv will not tell you
  about: duplicate keys, values that are silently empty, keys missing from
  .env.example, credentials pasted into an example file.

Options
      --file <path>     file to lint            (default: .env)
      --example <path>  reference file to diff  (default: .env.example)
      --all             also lint .env.local, .env.development, .env.test
      --strict          exit 1 on warnings too, not just errors
      --json            machine-readable output
      --no-color        plain text (also honours NO_COLOR)
  -q, --quiet           print nothing when clean
  -h, --help            show this help
  -v, --version         show the version

Exit codes
  0  no problems (or only notes)
  1  errors, or warnings with --strict
  2  bad usage, or the file could not be read

Example
  envlint                  # lint .env against .env.example
  envlint --strict         # warnings fail the build
  envlint --json | jq .counts
`;

const EXTRA_FILES = ['.env.local', '.env.development', '.env.test'];

const VALUE_FLAGS = new Set(['--file', '--example']);

export function parseArgs(argv) {
  const opts = { dir: '.', file: '.env', example: '.env.example', all: false, strict: false, json: false, color: null, quiet: false, help: false, version: false };
  const rest = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('-')) return { error: `missing value for ${arg}` };
      if (arg === '--file') opts.file = value;
      else opts.example = value;
      continue;
    }
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '-v' || arg === '--version') opts.version = true;
    else if (arg === '--all') opts.all = true;
    else if (arg === '--strict') opts.strict = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--no-color') opts.color = false;
    else if (arg === '-q' || arg === '--quiet') opts.quiet = true;
    else if (arg.startsWith('-')) return { error: `unknown option ${arg}` };
    else rest.push(arg);
  }

  if (rest.length > 1) return { error: `expected at most one directory, got ${rest.length}` };
  if (rest.length === 1) opts.dir = rest[0];
  return { opts };
}

/** Read and lint one directory. Exported so the CLI stays a thin wrapper. */
export function lintDirectory(dir, { file = '.env', example = '.env.example', all = false } = {}) {
  const envPath = path.resolve(dir, file);
  if (!fs.existsSync(envPath)) {
    const err = new Error(`no ${file} in ${path.resolve(dir)}`);
    err.code = 'ENOENT';
    throw err;
  }

  const envParsed = parseDotenv(fs.readFileSync(envPath, 'utf8'), { file: path.relative(dir, envPath) || file });
  const diagnosis = [...lintFile({ parsed: envParsed, kind: 'env' })];

  const ignorePath = path.resolve(dir, '.gitignore');
  const ignoreBody = fs.existsSync(ignorePath) ? fs.readFileSync(ignorePath, 'utf8') : '';
  if (!gitignoreCoversEnv(ignoreBody)) {
    diagnosis.push({
      file: envParsed.file,
      line: 1,
      severity: 'warn',
      code: 'env-not-ignored',
      message: `${envParsed.file} is not excluded by .gitignore; a stray "git add ." commits your secrets`,
    });
  }

  const examplePath = path.resolve(dir, example);
  const files = [envParsed.file];
  if (fs.existsSync(examplePath)) {
    const exampleParsed = parseDotenv(fs.readFileSync(examplePath, 'utf8'), { file: path.relative(dir, examplePath) || example });
    files.push(exampleParsed.file);
    diagnosis.push(...lintFile({ parsed: exampleParsed, kind: 'example' }));
    diagnosis.push(...lintDrift(exampleParsed, envParsed));
  }

  if (all) {
    for (const extra of EXTRA_FILES) {
      const extraPath = path.resolve(dir, extra);
      if (!fs.existsSync(extraPath)) continue;
      const parsed = parseDotenv(fs.readFileSync(extraPath, 'utf8'), { file: path.relative(dir, extraPath) || extra });
      files.push(parsed.file);
      diagnosis.push(...lintFile({ parsed, kind: 'env' }));
      if (fs.existsSync(examplePath)) {
        const exampleParsed = parseDotenv(fs.readFileSync(examplePath, 'utf8'), { file: path.relative(dir, examplePath) || example });
        diagnosis.push(...lintDrift(exampleParsed, parsed));
      }
    }
  }

  return { diagnostics: sortDiagnostics(diagnosis), files };
}

export function run(argv, io = process, deps = {}) {
  const { opts, error } = parseArgs(argv);
  if (error) {
    io.error(`envlint: ${error}`);
    return 2;
  }
  if (opts.help) {
    io.stdout.write(HELP);
    return 0;
  }
  if (opts.version) {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    io.stdout.write(`${pkg.version}\n`);
    return 0;
  }

  const colorEnabled = opts.color ?? (Boolean(io.stdout.isTTY) && !process.env.NO_COLOR && process.env.TERM !== 'dumb');
  const color = makeColors(colorEnabled);

  let result;
  try {
    result = (deps.lintDirectory ?? lintDirectory)(opts.dir, { file: opts.file, example: opts.example, all: opts.all });
  } catch (err) {
    io.error(`envlint: ${err.message}`);
    return 2;
  }

  const { diagnostics, files } = result;
  const counts = countBy(diagnostics);

  if (opts.json) {
    io.stdout.write(formatJson(diagnostics, { files, strict: opts.strict }));
  } else if (!opts.quiet || diagnostics.length) {
    if (diagnostics.length) io.stdout.write(formatDiagnostics(diagnostics, { color, files }));
    io.stdout.write(`${summarize(diagnostics)}\n`);
  }

  if (counts.error > 0) return 1;
  if (opts.strict && counts.warn > 0) return 1;
  return 0;
}
