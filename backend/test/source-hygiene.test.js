import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Control characters (tab and newlines excepted) and text-direction overrides.
// In source code they make the text shown in an editor or a PR differ from the code
// that runs ("Trojan Source"), most often hidden in comments: write them as escapes.
const INVISIBLE = /(?![\t\r])[\p{Cc}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path);
    return /\.(js|sql|json)$/.test(entry.name) ? [path] : [];
  });
}

function findInvisible(text) {
  return text
    .split('\n')
    .flatMap((line, i) =>
      [...line.matchAll(INVISIBLE)].map(
        (m) =>
          `line ${i + 1}: U+${m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
      ),
    );
}

test('the detector spots a text-direction override hidden in a comment', () => {
  const planted = `const isAdmin = false; // ${String.fromCodePoint(0x202e)} } if (isAdmin) {`;

  assert.deepEqual(findInvisible(planted), ['line 1: U+202E']);
});

test('no source file contains invisible control or text-direction characters', () => {
  const files = [...sourceFiles(join(ROOT, 'src')), ...sourceFiles(join(ROOT, 'test'))];
  const found = files.flatMap((file) =>
    findInvisible(readFileSync(file, 'utf8')).map((hit) => `${file.slice(ROOT.length)} ${hit}`),
  );

  assert.ok(files.length > 10, 'no source file found');
  assert.deepEqual(found, []);
});
