import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

// Lints snippets with the project's real eslint.config.js
const eslint = new ESLint({ cwd: fileURLToPath(new URL('..', import.meta.url)) });

async function sqlErrors(code) {
  const [result] = await eslint.lintText(`const conn = {}; const id = 1;\n${code}\n`, {
    filePath: 'src/example.js',
  });
  return result.messages.filter((m) => m.ruleId === 'no-restricted-syntax');
}

test('SQL built with ${} or + is a lint error', async () => {
  for (const code of [
    'conn.query(`SELECT * FROM users WHERE id = ${id}`);',
    "conn.execute('SELECT * FROM users WHERE id = ' + id);",
    'conn.query(`DELETE FROM rooms WHERE owner_id = ${id}`, []);',
  ]) {
    assert.equal((await sqlErrors(code)).length, 1, code);
  }
});

test('placeholders and multi-line templates without ${} are allowed', async () => {
  for (const code of [
    "conn.query('SELECT * FROM users WHERE id = ?', [id]);",
    'conn.query(`\n  SELECT id\n  FROM users\n  WHERE id = ?`, [id]);',
  ]) {
    assert.deepEqual(await sqlErrors(code), [], code);
  }
});
