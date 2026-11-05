import { test } from 'node:test';
import assert from 'node:assert/strict';
import { premiumIssues } from '../src/users/plan.js';

const open = { visibility: 'public', accessPolicy: 'everyone', beaconMinor: null };
const paths = (issues) => issues.map((issue) => issue.path);

test('a public room open to everyone, without beacon, needs nothing', () => {
  assert.deepEqual(premiumIssues(open), []);
});

test('private, invited, place_time and a beacon each need premium', () => {
  assert.deepEqual(paths(premiumIssues({ ...open, visibility: 'private' })), ['visibility']);
  assert.deepEqual(paths(premiumIssues({ ...open, accessPolicy: 'invited' })), ['accessPolicy']);
  assert.deepEqual(paths(premiumIssues({ ...open, accessPolicy: 'place_time' })), ['accessPolicy']);
  assert.deepEqual(paths(premiumIssues({ ...open, beaconMinor: 0 })), ['beaconMinor']);
  assert.deepEqual(
    paths(premiumIssues({ visibility: 'private', accessPolicy: 'invited', beaconMinor: 7 })),
    ['visibility', 'accessPolicy', 'beaconMinor'],
  );
});

test('with the stored room, only new premium values count', () => {
  const stored = { visibility: 'private', accessPolicy: 'invited', beaconMinor: 7 };
  assert.deepEqual(premiumIssues({ ...stored, name: 'renamed' }, stored), []);
  assert.deepEqual(paths(premiumIssues({ ...stored, beaconMinor: 8 }, stored)), ['beaconMinor']);
  assert.deepEqual(paths(premiumIssues({ ...stored, accessPolicy: 'place_time' }, stored)), [
    'accessPolicy',
  ]);
  assert.deepEqual(premiumIssues(open, stored), []);
});
