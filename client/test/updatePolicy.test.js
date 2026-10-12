import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideUpdateAction,
  isValidBuildId,
  shouldCheck
} from '../src/utils/updatePolicy.js';

describe('updatePolicy pure function tests (P-1 ~ P-10)', () => {
  test('P-1: Returns none when current and latest buildId are identical', () => {
    const action = decideUpdateAction({
      currentBuildId: 'build-123',
      latestBuildId: 'build-123',
      guard: null,
      busy: false,
      storageAvailable: true
    });
    assert.equal(action, 'none');
  });

  test('P-2: Returns reload when buildIds differ, no guard, busy false', () => {
    const action = decideUpdateAction({
      currentBuildId: 'build-123',
      latestBuildId: 'build-456',
      guard: null,
      busy: false,
      storageAvailable: true
    });
    assert.equal(action, 'reload');
  });

  test('P-3: Returns notify when buildIds differ, no guard, busy true', () => {
    const action = decideUpdateAction({
      currentBuildId: 'build-123',
      latestBuildId: 'build-456',
      guard: null,
      busy: true,
      storageAvailable: true
    });
    assert.equal(action, 'notify');
  });

  test('P-4: Returns give-up when buildIds differ and guard for same target has attempts >= 1', () => {
    const action = decideUpdateAction({
      currentBuildId: 'build-123',
      latestBuildId: 'build-456',
      guard: { targetBuildId: 'build-456', attempts: 1, at: Date.now() },
      busy: false,
      storageAvailable: true
    });
    assert.equal(action, 'give-up');
  });

  test('P-5: Returns reload when guard targetBuildId is different from latestBuildId', () => {
    const action = decideUpdateAction({
      currentBuildId: 'build-123',
      latestBuildId: 'build-789',
      guard: { targetBuildId: 'build-456', attempts: 1, at: Date.now() },
      busy: false,
      storageAvailable: true
    });
    assert.equal(action, 'reload');
  });

  test('P-6: Returns notify when storageAvailable is false', () => {
    const action = decideUpdateAction({
      currentBuildId: 'build-123',
      latestBuildId: 'build-456',
      guard: null,
      busy: false,
      storageAvailable: false
    });
    assert.equal(action, 'notify');
  });

  test('P-7: isValidBuildId returns false for null, empty, numbers, or > 200 chars', () => {
    assert.equal(isValidBuildId(null), false);
    assert.equal(isValidBuildId(undefined), false);
    assert.equal(isValidBuildId(''), false);
    assert.equal(isValidBuildId('   '), false);
    assert.equal(isValidBuildId(12345), false);
    assert.equal(isValidBuildId({}), false);
    assert.equal(isValidBuildId('a'.repeat(201)), false);
    assert.equal(isValidBuildId('a'.repeat(200)), true);
    assert.equal(isValidBuildId('build-123'), true);
  });

  test('P-8: shouldCheck returns false when checked 30 seconds ago (< 60s)', () => {
    const now = 100000;
    const lastCheckedAt = now - 30000;
    const result = shouldCheck({
      now,
      lastCheckedAt,
      inFlight: false,
      online: true,
      minIntervalMs: 60000
    });
    assert.equal(result, false);
  });

  test('P-9: shouldCheck returns true when checked 61 seconds ago, not inFlight, online', () => {
    const now = 100000;
    const lastCheckedAt = now - 61000;
    const result = shouldCheck({
      now,
      lastCheckedAt,
      inFlight: false,
      online: true,
      minIntervalMs: 60000
    });
    assert.equal(result, true);
  });

  test('P-10: shouldCheck returns false when inFlight or offline', () => {
    const now = 100000;
    const lastCheckedAt = 0;
    assert.equal(shouldCheck({ now, lastCheckedAt, inFlight: true, online: true }), false);
    assert.equal(shouldCheck({ now, lastCheckedAt, inFlight: false, online: false }), false);
    assert.equal(shouldCheck({ now, lastCheckedAt, inFlight: true, online: false }), false);
  });
});
