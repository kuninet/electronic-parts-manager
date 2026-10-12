/**
 * 部品一覧の範囲選択およびドラッグ選択の純粋関数モジュール
 */

/**
 * Shift+クリックの範囲選択。
 * @param {object} p
 * @param {number[]} p.orderedIds 表示順の ID（displayedParts の順）
 * @param {number[]} p.selectedIds 現在の選択
 * @param {number|null} p.anchorId 直前に操作した ID（起点）
 * @param {number} p.targetId Shift+クリックした ID
 * @param {boolean} p.select 範囲を選択にするなら true、解除なら false
 * @returns {number[]} 新しい選択（元の配列は書き換えない）
 */
export function applyRangeSelection({
  orderedIds = [],
  selectedIds = [],
  anchorId = null,
  targetId,
  select = true
}) {
  const currentSelected = [...selectedIds];
  const targetIdx = orderedIds.indexOf(targetId);

  // targetId が表示順に含まれない場合（安全策）
  if (targetIdx === -1) {
    if (select) {
      return currentSelected.includes(targetId) ? currentSelected : [...currentSelected, targetId];
    } else {
      return currentSelected.filter((id) => id !== targetId);
    }
  }

  const anchorIdx = anchorId !== null ? orderedIds.indexOf(anchorId) : -1;

  // anchorId が null、または orderedIds に無い場合は targetId のみ対象
  if (anchorId === null || anchorIdx === -1) {
    if (select) {
      return currentSelected.includes(targetId) ? currentSelected : [...currentSelected, targetId];
    } else {
      return currentSelected.filter((id) => id !== targetId);
    }
  }

  // 起点から対象までの範囲（両端を含む）
  const [startIdx, endIdx] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
  const rangeSlice = orderedIds.slice(startIdx, endIdx + 1);
  const rangeSet = new Set(rangeSlice);

  if (select) {
    // 既存の選択順を保ち、新しく選んだものを表示順で末尾に足す（重複なし）
    const result = [...currentSelected];
    const selectedSet = new Set(currentSelected);
    for (const id of rangeSlice) {
      if (!selectedSet.has(id)) {
        result.push(id);
        selectedSet.add(id);
      }
    }
    return result;
  } else {
    // 範囲内の項目を解除
    return currentSelected.filter((id) => !rangeSet.has(id));
  }
}

/**
 * ドラッグ中の選択。baseline に、start から current までの範囲を mode で上書きしたもの。
 * 戻る方向に動かすと範囲が縮み、外れた項目は baseline の状態に戻る。
 * @param {object} p
 * @param {number[]} p.orderedIds 表示順の ID（displayedParts の順）
 * @param {number[]} p.baseline ドラッグ開始時点の選択 ID 配列
 * @param {number} p.startId ドラッグ開始時の ID
 * @param {number} p.currentId 現在マウス下にある ID
 * @param {boolean} p.select 範囲を選択にするなら true、解除なら false
 * @returns {number[]} 新しい選択（元の配列は書き換えない）
 */
export function applyDragSelection({
  orderedIds = [],
  baseline = [],
  startId,
  currentId,
  select = true
}) {
  const startIdx = orderedIds.indexOf(startId);
  const currentIdx = orderedIds.indexOf(currentId);

  // いずれかが表示順にない場合は baseline の複製を返す
  if (startIdx === -1 || currentIdx === -1) {
    return [...baseline];
  }

  const [fromIdx, toIdx] = startIdx < currentIdx ? [startIdx, currentIdx] : [currentIdx, startIdx];
  const rangeSlice = orderedIds.slice(fromIdx, toIdx + 1);
  const rangeSet = new Set(rangeSlice);

  if (select) {
    const result = [...baseline];
    const baseSet = new Set(baseline);
    for (const id of rangeSlice) {
      if (!baseSet.has(id)) {
        result.push(id);
        baseSet.add(id);
      }
    }
    return result;
  } else {
    return baseline.filter((id) => !rangeSet.has(id));
  }
}
