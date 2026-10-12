import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  addStoreResult,
  markUndoing,
  markUndone,
  markUndoError,
  activeCount,
  shouldIgnoreScan
} from '../src/utils/storeSession.js';

describe('storeSession pure function tests (R-1 ~ R-9)', () => {
  const dummyPart1 = { id: 1, name: 'Part A', part_number: 'PA-01', quantity: 10, image_path: '/img/a.jpg' };
  const dummyPart2 = { id: 2, name: 'Part B', part_number: 'PB-02', quantity: 5, image_path: null };
  const dummyPart3 = { id: 3, name: 'Part C', part_number: null, quantity: 1, image_path: '/img/c.jpg' };

  test('R-1: 3 件追加すると、新しい順に並ぶ', () => {
    let entries = [];
    entries = addStoreResult(entries, {
      part: dummyPart1,
      response: { log_id: 101, part_id: 1, location_id: 10, previous_location_id: 5, previous_location_name: '棚1' }
    });
    entries = addStoreResult(entries, {
      part: dummyPart2,
      response: { log_id: 102, part_id: 2, location_id: 10, previous_location_id: null, previous_location_name: null }
    });
    entries = addStoreResult(entries, {
      part: dummyPart3,
      response: { log_id: 103, part_id: 3, location_id: 10, previous_location_id: 6, previous_location_name: '棚2' }
    });

    assert.equal(entries.length, 3);
    assert.equal(entries[0].part.id, 3);
    assert.equal(entries[1].part.id, 2);
    assert.equal(entries[2].part.id, 1);
  });

  test('R-2: 取り消していない同じ部品をもう一度追加すると、件数は増えず、その部品が先頭に移る', () => {
    let entries = [];
    entries = addStoreResult(entries, {
      part: dummyPart1,
      response: { log_id: 101, part_id: 1, location_id: 10, previous_location_id: 5, previous_location_name: '棚1' }
    });
    entries = addStoreResult(entries, {
      part: dummyPart2,
      response: { log_id: 102, part_id: 2, location_id: 10, previous_location_id: null, previous_location_name: null }
    });

    // 順序は [Part B, Part A]
    assert.equal(entries.length, 2);
    assert.equal(entries[0].part.id, 2);
    assert.equal(entries[1].part.id, 1);

    // Part A をもう一度追加
    entries = addStoreResult(entries, {
      part: dummyPart1,
      response: { unchanged: true, part_id: 1, location_id: 10, log_id: null }
    });

    // 件数は 2 件のままで、Part A が先頭に移る
    assert.equal(entries.length, 2);
    assert.equal(entries[0].part.id, 1);
    assert.equal(entries[1].part.id, 2);
  });

  test('R-2b: 取り消していない同じ部品でunchanged: falseの応答（再格納）が来たら新しいlogIdで置換される', () => {
    let entries = [];
    entries = addStoreResult(entries, {
      part: dummyPart1,
      response: { log_id: 101, part_id: 1, location_id: 10, previous_location_id: 5, previous_location_name: '棚1' }
    });
    entries = addStoreResult(entries, {
      part: dummyPart2,
      response: { log_id: 102, part_id: 2, location_id: 10, previous_location_id: null, previous_location_name: null }
    });

    // 順序は [Part B, Part A (log-101)]
    assert.equal(entries.length, 2);

    // Part A が別場所から再度格納され、新ログ105が発行された場合
    entries = addStoreResult(entries, {
      part: dummyPart1,
      response: { log_id: 105, part_id: 1, location_id: 10, previous_location_id: 8, previous_location_name: '棚3', unchanged: false }
    });

    // 件数は 2 件のままで、Part A が新しいログID (log-105) で先頭に移る
    assert.equal(entries.length, 2);
    assert.equal(entries[0].part.id, 1);
    assert.equal(entries[0].logId, 105);
    assert.equal(entries[0].key, 'log-105');
    assert.equal(entries[0].previousLocationName, '棚3');
    assert.equal(entries[1].part.id, 2);
  });

  test('R-3: 取り消し済みの同じ部品をもう一度追加すると、新しいカードとして追加される', () => {
    let entries = [];
    entries = addStoreResult(entries, {
      part: dummyPart1,
      response: { log_id: 101, part_id: 1, location_id: 10, previous_location_id: 5, previous_location_name: '棚1' }
    });

    // Part A を取り消し完了にする
    entries = markUndone(entries, 'log-101', { restored_location_name: '棚1' });
    assert.equal(entries[0].status, 'undone');

    // 取り消し済みの状態で、同じ Part A を再格納
    entries = addStoreResult(entries, {
      part: dummyPart1,
      response: { log_id: 104, part_id: 1, location_id: 10, previous_location_id: 5, previous_location_name: '棚1' }
    });

    // 取り消し済みカードと新規格納カードの 2 件になる
    assert.equal(entries.length, 2);
    assert.equal(entries[0].key, 'log-104');
    assert.equal(entries[0].status, 'stored');
    assert.equal(entries[1].key, 'log-101');
    assert.equal(entries[1].status, 'undone');
  });

  test('R-4: unchanged の応答は status: "unchanged" になる', () => {
    let entries = [];
    entries = addStoreResult(entries, {
      part: dummyPart1,
      response: { unchanged: true, log_id: null, part_id: 1, location_id: 10, previous_location_name: '棚1' }
    });

    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, 'unchanged');
    assert.equal(entries[0].logId, null);
  });

  test('R-5: markUndoing -> markUndone で status が undone になり、restoredLocationName が入る', () => {
    let entries = [
      {
        key: 'log-101',
        logId: 101,
        part: dummyPart1,
        status: 'stored',
        error: null,
        restoredLocationName: null
      }
    ];

    entries = markUndoing(entries, 'log-101');
    assert.equal(entries[0].status, 'undoing');

    entries = markUndone(entries, 'log-101', { restored_location_name: '棚A' });
    assert.equal(entries[0].status, 'undone');
    assert.equal(entries[0].restoredLocationName, '棚A');
    assert.equal(entries[0].error, null);
  });

  test('R-6: markUndoError の retryable が偽なら、戻すボタンを出さない状態になる', () => {
    let entries = [
      {
        key: 'log-101',
        logId: 101,
        part: dummyPart1,
        status: 'undoing',
        error: null
      }
    ];

    // 409など再試行不可のエラー
    entries = markUndoError(entries, 'log-101', {
      message: 'ほかの保管場所に移されているため、戻せません',
      retryable: false
    });

    assert.equal(entries[0].status, 'error');
    assert.equal(entries[0].error.retryable, false);
    assert.equal(entries[0].error.message, 'ほかの保管場所に移されているため、戻せません');

    // 通信エラーなど再試行可能なエラー
    entries = markUndoError(entries, 'log-101', {
      message: 'ネットワークエラー',
      retryable: true
    });
    assert.equal(entries[0].status, 'error');
    assert.equal(entries[0].error.retryable, true);
  });

  test('R-7: activeCount は stored だけを数える', () => {
    const entries = [
      { key: '1', status: 'stored' },
      { key: '2', status: 'undone' },
      { key: '3', status: 'stored' },
      { key: '4', status: 'undoing' },
      { key: '5', status: 'unchanged' },
      { key: '6', status: 'error' }
    ];

    assert.equal(activeCount(entries), 2);
  });

  test('R-8: shouldIgnoreScan: 同じ文字列を 2.9 秒後に読むと真、3.1 秒後なら偽、別の文字列ならすぐでも偽', () => {
    const baseTime = 10000;
    const text = 'PART-001';

    // 2.9秒後（2900ms）: 同一テキストなら true
    assert.equal(
      shouldIgnoreScan({
        text,
        lastText: text,
        lastAt: baseTime,
        now: baseTime + 2900,
        cooldownMs: 3000
      }),
      true
    );

    // 3.1秒後（3100ms）: 同一テキストでも false
    assert.equal(
      shouldIgnoreScan({
        text,
        lastText: text,
        lastAt: baseTime,
        now: baseTime + 3100,
        cooldownMs: 3000
      }),
      false
    );

    // 100ms後でも別のテキストなら false
    assert.equal(
      shouldIgnoreScan({
        text: 'PART-002',
        lastText: text,
        lastAt: baseTime,
        now: baseTime + 100,
        cooldownMs: 3000
      }),
      false
    );

    // lastText なし、または lastAt なしなら false
    assert.equal(
      shouldIgnoreScan({ text, lastText: null, lastAt: null, now: baseTime }),
      false
    );
  });

  test('R-9: どの関数も元の配列を書き換えない（新しい配列を返す）', () => {
    const initialEntry = {
      key: 'log-1',
      logId: 1,
      part: dummyPart1,
      status: 'stored',
      error: null,
      restoredLocationName: null
    };
    const original = [initialEntry];
    Object.freeze(original);
    Object.freeze(initialEntry);

    // addStoreResult
    const afterAdd = addStoreResult(original, {
      part: dummyPart2,
      response: { log_id: 2, part_id: 2 }
    });
    assert.notEqual(original, afterAdd);
    assert.equal(original.length, 1);
    assert.equal(afterAdd.length, 2);

    // markUndoing
    const afterUndoing = markUndoing(original, 'log-1');
    assert.notEqual(original, afterUndoing);
    assert.equal(original[0].status, 'stored');
    assert.equal(afterUndoing[0].status, 'undoing');

    // markUndone
    const afterUndone = markUndone(original, 'log-1', { restored_location_name: '箱' });
    assert.notEqual(original, afterUndone);
    assert.equal(original[0].status, 'stored');
    assert.equal(afterUndone[0].status, 'undone');

    // markUndoError
    const afterError = markUndoError(original, 'log-1', { message: 'err', retryable: true });
    assert.notEqual(original, afterError);
    assert.equal(original[0].status, 'stored');
    assert.equal(afterError[0].status, 'error');
  });
});
