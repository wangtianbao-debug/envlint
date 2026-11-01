# envlint

**Catch .env mistakes before they bite.** Duplicate keys, silently empty values, drift from `.env.example`, credentials pasted into the wrong file.

![node](https://img.shields.io/badge/node-%3E%3D18-3c873a) ![deps](https://img.shields.io/badge/dependencies-0-blue) ![license](https://img.shields.io/badge/license-MIT-black)

```
$ envlint
.env
  1  error  duplicate-key       DATABASE_URL is already defined on line 1; the later value wins
  2  warn   space-after-equals  PORT has whitespace after "=", which most parsers keep as part of the value
  3  warn   empty-value         API_KEY is empty
  4  warn   possible-secret     GITHUB_TOKEN looks like a live credential; keep this file out of git
  5  warn   undocumented-key    SECRET is set but not documented in .env.example
  5  note   trailing-space      SECRET has trailing whitespace in its value

7 problems (1 error, 4 warnings, 2 notes)
```

## Why

`dotenv` is deliberately forgiving: it never complains, it just produces whatever
your program will see. That silence is how you end up with a variable defined
twice where the wrong value wins, a key that only exists on the machine of the
person who added it, and an API token sitting in a file that `git add .` was
about to include.

`envlint` reads the file the way the parser does — quotes, inline comments,
escapes — then tells you what is wrong with it.

## Install

Not on npm yet, so clone and link:

```sh
git clone https://github.com/wangtianbao-debug/envlint.git
cd envlint
npm link        # puts `envlint` on your PATH
```

Node 18 or newer. No dependencies, no build step.

## Usage

```
$ envlint                 # lint ./.env against ./.env.example
$ envlint ./services/api  # lint another directory
$ envlint --strict        # exit 1 on warnings too
$ envlint --json | jq .counts
$ envlint --all           # also lint .env.local, .env.development, .env.test
```

### Options

| Option | Description |
| --- | --- |
| `--file <path>` | file to lint (default `.env`) |
| `--example <path>` | reference file to compare against (default `.env.example`) |
| `--all` | also lint `.env.local`, `.env.development`, `.env.test` |
| `--strict` | exit `1` on warnings, not just errors |
| `--json` | counts and diagnostics as JSON |
| `--no-color` | plain text (also honours `NO_COLOR`) |
| `-q`, `--quiet` | print nothing when clean |

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | clean, or notes only |
| `1` | at least one error (or a warning with `--strict`) |
| `2` | bad usage, or `.env` could not be read |

## Rules

| Code | Severity | What it means |
| --- | --- | --- |
| `duplicate-key` | error | the same key is defined twice; the later value wins |
| `bad-key` | error | the name cannot be an environment variable (`1TOKEN`, `my key`) |
| `bad-line` | error | a line that is neither a comment nor `KEY=value` |
| `unterminated-quote` | error | a quote opens and never closes, swallowing the rest of the file |
| `secret-in-example` | error | a real-looking credential inside `.env.example` |
| `empty-value` | warn | `KEY=` — declared, but nothing to read |
| `space-after-equals` | warn | `KEY= value` keeps the leading space in most parsers |
| `possible-secret` | warn | the value looks like a live token, not a placeholder |
| `undocumented-key` | warn | set in `.env`, missing from `.env.example` |
| `env-not-ignored` | warn | `.gitignore` does not exclude `.env` |
| `bom` | warn | a UTF-8 BOM would corrupt the first key |
| `missing-value` | warn | a bare `KEY` with no `=` |
| `missing-from-env` | note | documented in `.env.example`, never set |
| `trailing-space` | note | invisible whitespace at the end of a value |
| `crlf` | note | CRLF line endings |

Placeholders are understood: `<token>`, `${VAR}`, `changeme`, `your-api-key`
and empty values are not reported as secrets.

## Drift, not just syntax

`.env.example` is the contract. `envlint` compares both directions:

- a key in the example that `.env` never sets → `missing-from-env` (you forgot to configure it)
- a key in `.env` the example never mentions → `undocumented-key` (nobody else can configure it)

## Library use

```js
import { lintText, parseDotenv, lintDrift, summarize } from 'envlint';

const diagnostics = lintText(fs.readFileSync('.env', 'utf8'), { file: '.env' });
console.log(summarize(diagnostics)); // "2 problems (1 error, 1 warning)"

const example = parseDotenv(fs.readFileSync('.env.example', 'utf8'), { file: '.env.example' });
const env = parseDotenv(fs.readFileSync('.env', 'utf8'), { file: '.env' });
const drift = lintDrift(example, env);
```

`parseDotenv` keeps what the checks need: line numbers, the quote character,
inline comments, `export`, and whether whitespace followed the `=`.

## Limits worth knowing

- This is a hygiene linter, not a secret scanner. `possible-secret` is a
  heuristic (well-known prefixes plus long random-looking strings); it can miss
  unusual formats and it will never replace rotating a leaked key.
- Values are read literally: `${VAR}` expansion is a runtime concern, so
  `envlint` checks what is written in the file.
- Only `.env` is linted by default. Secrets that live in `.env.local` are only
  checked with `--all`.

## Tests

```sh
node --test
```

42 tests covering the parser (quotes, escapes, comments, BOM, CRLF), every rule,
the drift comparison, the report formats and the CLI exit codes.

## CI

GitHub blocks pushing workflows with this token, so the pipeline lives in
[`ci/ci.yml`](ci/ci.yml). Copy it to `.github/workflows/ci.yml` to enable it.

## License

MIT
