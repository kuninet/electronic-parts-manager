import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRangeSelection,
  applyDragSelection
} from '../src/utils/rangeSelect.js';

describe('rangeSelect pure function tests (R-1 ~ R-12)', () => {
  test('R-1: 表示順 [1..6]、選択 [2]、起点 2 から 5 を select: true で範囲選択すると [2, 3, 4, 5]', () => {
    const orderedIds = [1, 2, 3, 4, 5, 6];
    const selectedIds = [2];
    const result = applyRangeSelection({
      orderedIds,
      selectedIds,
      anchorId: 2,
      targetId: 5,
      select: true
    });
    assert.deepEqual(result, [2, 3, 4, 5]);
  });

  test('R-2: 起点 5、対象 2（上向き）で 2〜5 が選択される', () => {
    const orderedIds = [1, 2, 3, 4, 5, 6];
    const selectedIds = [5];
    const result = applyRangeSelection({
      orderedIds,
      selectedIds,
      anchorId: 5,
      targetId: 2,
      select: true
    });
    assert.deepEqual(result, [5, 2, 3, 4]); // 既存の 5 を保ち、表示順の 2, 3, 4 を追加
  });

  test('R-3: 選択 [1..6]、起点 2 から 4 を select: false で [1, 5, 6]', () => {
    const orderedIds = [1, 2, 3, 4, 5, 6];
    const selectedIds = [1, 2, 3, 4, 5, 6];
    const result = applyRangeSelection({
      orderedIds,
      selectedIds,
      anchorId: 2,
      targetId: 4,
      select: false
    });
    // 2, 3, 4 が解除されるため [1, 5, 6]
    assert.deepEqual(result, [1, 5, 6]);
  });

  test('R-4: 起点が null の場合は対象 4 のみ追加される', () => {
    const orderedIds = [1, 2, 3, 4, 5, 6];
    const selectedIds = [1, 2];
    const result = applyRangeSelection({
      orderedIds,
      selectedIds,
      anchorId: null,
      targetId: 4,
      select: true
    });
    assert.deepEqual(result, [1, 2, 4]);
  });

  test('R-5: 起点が orderedIds に無い（絞り込み等で消えた）場合は対象 4 のみ追加される', () => {
    const orderedIds = [1, 2, 3, 4, 5, 6];
    const selectedIds = [1];
    const result = applyRangeSelection({
      orderedIds,
      selectedIds,
      anchorId: 99,
      targetId: 4,
      select: true
    });
    assert.deepEqual(result, [1, 4]);
  });

  test('R-6: 選択 [9, 2]（9 は範囲外）で 2〜4 を選択すると [9, 2, 3, 4]（既存順を維持・重複なし）', () => {
    const orderedIds = [1, 2, 3, 4, 5, 6];
    const selectedIds = [9, 2];
    const result = applyRangeSelection({
      orderedIds,
      selectedIds,
      anchorId: 2,
      targetId: 4,
      select: true
    });
    assert.deepEqual(result, [9, 2, 3, 4]);
  });

  test('R-7: 表示順が [5, 3, 8, 1]（並べ替え後）で起点 3、対象 1 のとき 3, 8, 1 が選択される（ID の大小ではなく表示順）', () => {
    const orderedIds = [5, 3, 8, 1];
    const selectedIds = [];
    const result = applyRangeSelection({
      orderedIds,
      selectedIds,
      anchorId: 3,
      targetId: 1,
      select: true
    });
    assert.deepEqual(result, [3, 8, 1]);
  });

  test('R-8: 起点と対象が同じ場合はその 1 件のみ対象となる', () => {
    const orderedIds = [1, 2, 3, 4];
    const selectedIds = [1];
    const result = applyRangeSelection({
      orderedIds,
      selectedIds,
      anchorId: 3,
      targetId: 3,
      select: true
    });
    assert.deepEqual(result, [1, 3]);
  });

  test('R-9: applyDragSelection: baseline = []、start 2、current 5、select: true で [2, 3, 4, 5]', () => {
    const orderedIds = [1, 2, 3, 4, 5, 6];
    const baseline = [];
    const result = applyDragSelection({
      orderedIds,
      baseline,
      startId: 2,
      currentId: 5,
      select: true
    });
    assert.deepEqual(result, [2, 3, 4, 5]);
  });

  test('R-10: R-9 の後に current 3 に戻ると [2, 3]（4・5 は baseline の状態に戻る）', () => {
    const orderedIds = [1, 2, 3, 4, 5, 6];
    const baseline = [];
    const result = applyDragSelection({
      orderedIds,
      baseline,
      startId: 2,
      currentId: 3,
      select: true
    });
    assert.deepEqual(result, [2, 3]);
  });

  test('R-11: baseline = [1..6]、start 4、current 2、select: false で [1, 5, 6]', () => {
    const orderedIds = [1, 2, 3, 4, 5, 6];
    const baseline = [1, 2, 3, 4, 5, 6];
    const result = applyDragSelection({
      orderedIds,
      baseline,
      startId: 4,
      currentId: 2,
      select: false
    });
    assert.deepEqual(result, [1, 5, 6]);
  });

  test('R-12: どの関数も引数の配列を書き換えない（イミュータブル）', () => {
    const orderedIds = Object.freeze([1, 2, 3, 4, 5, 6]);
    const selectedIds = Object.freeze([2]);
    const baseline = Object.freeze([1, 2, 3]);

    assert.doesNotThrow(() => {
      applyRangeSelection({
        orderedIds,
        selectedIds,
        anchorId: 2,
        targetId: 5,
        select: true
      });
      applyDragSelection({
        orderedIds,
        baseline,
        startId: 2,
        currentId: 5,
        select: true
      });
    });
  });
});
