import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEntry,
  applyStep,
  applySet,
  beginFlush,
  onSuccess,
  onFailure,
  isSettled
} from '../src/utils/quantityQueue.js';

describe('Quantity Queue Pure Function Tests', () => {
  test('Q-1: applyStep(+1) 5 times from 10 results in display 15, beginFlush send=15, inFlight=true', () => {
    let e = createEntry(10);
    for (let i = 0; i < 5; i++) {
      e = applyStep(e, 1);
    }
    assert.equal(e.display, 15);
    assert.equal(e.dirty, true);

    const r = beginFlush(e);
    assert.ok(r);
    assert.equal(r.send, 15);
    assert.equal(r.entry.inFlight, true);
    assert.equal(r.entry.dirty, false);
    assert.equal(r.entry.display, 15);
  });

  test('Q-2: in-flight queuing and follow-up flush on success', () => {
    let e = createEntry(10);
    e = applyStep(e, 5); // display 15
    const r1 = beginFlush(e);
    e = r1.entry; // inFlight=true, dirty=false

    // 送信中に追加操作
    e = applyStep(e, 1); // display 16, dirty=true
    assert.equal(e.display, 16);
    assert.equal(e.dirty, true);

    const rBlocked = beginFlush(e);
    assert.equal(rBlocked, null, 'beginFlush should return null while in-flight');

    // 最初の送信が成功（サーバー確定値 15）
    e = onSuccess(e, 15);
    assert.equal(e.inFlight, false);
    assert.equal(e.confirmed, 15);
    assert.equal(e.display, 16);
    assert.equal(e.dirty, true);

    // 次の送信を開始
    const r2 = beginFlush(e);
    assert.ok(r2);
    assert.equal(r2.send, 16);
    assert.equal(r2.entry.inFlight, true);
  });

  test('Q-3: onFailure restores display to confirmed and clears inFlight/dirty', () => {
    let e = createEntry(10);
    e = applyStep(e, 3); // display 13
    const r = beginFlush(e);
    e = r.entry;

    e = onFailure(e);
    assert.equal(e.display, 10);
    assert.equal(e.confirmed, 10);
    assert.equal(e.inFlight, false);
    assert.equal(e.dirty, false);
  });

  test('Q-4: applyStep(-1) at 0 cannot go below 0', () => {
    let e = createEntry(0);
    e = applyStep(e, -1);
    assert.equal(e.display, 0);
  });

  test('Q-5: applySet handles strings, floats, negatives, and invalid inputs', () => {
    let e = createEntry(10);
    e = applySet(e, '7.9');
    assert.equal(e.display, 7);

    e = applySet(e, -3);
    assert.equal(e.display, 0);

    e = applySet(e, 'abc');
    assert.equal(e.display, 0);
  });

  test('Q-6: +1 followed by -1 back to confirmed returns send: null', () => {
    let e = createEntry(10);
    e = applyStep(e, 1); // 11
    e = applyStep(e, -1); // 10
    assert.equal(e.display, 10);
    assert.equal(e.dirty, true);

    const r = beginFlush(e);
    assert.ok(r);
    assert.equal(r.send, null);
    assert.equal(r.entry.dirty, false);
    assert.equal(r.entry.inFlight, false);
  });

  test('Q-7: isSettled is true only when !inFlight && !dirty && display === confirmed', () => {
    let e = createEntry(10);
    assert.equal(isSettled(e), true);

    e = applyStep(e, 1);
    assert.equal(isSettled(e), false);

    const r = beginFlush(e);
    e = r.entry;
    assert.equal(isSettled(e), false);

    e = onSuccess(e, 11);
    assert.equal(isSettled(e), true);
  });
});
