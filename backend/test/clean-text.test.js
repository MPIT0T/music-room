import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanText } from '../src/validation.js';

// Characters built from code points: the source file itself stays free of invisible characters
const RLO = String.fromCodePoint(0x202e);
const NUL = String.fromCodePoint(0);
const E_ACUTE_DECOMPOSED = 'e' + String.fromCodePoint(0x301);
const SMILE = String.fromCodePoint(0x1f600);

test('cleanText removes control and direction characters instead of refusing', () => {
  assert.equal(cleanText(`Max${RLO}evil${NUL}`, 50), 'Maxevil');
});

test('cleanText normalizes to NFC and trims', () => {
  assert.equal(cleanText(`  Ren${E_ACUTE_DECOMPOSED}  `, 50), 'Ren' + String.fromCodePoint(0xe9));
});

test('cleanText cuts on code points, never inside an emoji', () => {
  assert.equal(cleanText(`ab${SMILE}cd`, 3), `ab${SMILE}`);
});

test('cleanText of a missing or blank value is empty', () => {
  assert.equal(cleanText(undefined, 50), '');
  assert.equal(cleanText(` ${RLO} `, 50), '');
});
