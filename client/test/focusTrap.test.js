import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nextTrapIndex, FOCUSABLE_SELECTOR } from '../src/utils/focusTrap.js';

describe('focusTrap utility tests', () => {
  test('F-1: Tab forwards from index 0 to 1', () => {
    assert.equal(nextTrapIndex(0, 3, false), 1);
  });

  test('F-2: Tab wraps from last index (2) back to 0', () => {
    assert.equal(nextTrapIndex(2, 3, false), 0);
  });

  test('F-3: Shift+Tab wraps from index 0 back to last index (2)', () => {
    assert.equal(nextTrapIndex(0, 3, true), 2);
  });

  test('F-4: Focus outside panel (-1) moves to 0 (Tab) or count - 1 (Shift+Tab)', () => {
    assert.equal(nextTrapIndex(-1, 3, false), 0);
    assert.equal(nextTrapIndex(-1, 3, true), 2);
  });

  test('F-5: count <= 0 returns -1', () => {
    assert.equal(nextTrapIndex(0, 0, false), -1);
    assert.equal(nextTrapIndex(-1, 0, true), -1);
    assert.equal(nextTrapIndex(1, -1, false), -1);
  });

  test('FOCUSABLE_SELECTOR contains expected element types', () => {
    assert.ok(FOCUSABLE_SELECTOR.includes('button:not([disabled])'));
    assert.ok(FOCUSABLE_SELECTOR.includes('[tabindex]:not([tabindex="-1"])'));
  });
});
