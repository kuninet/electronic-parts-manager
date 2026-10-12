import { ref, onUnmounted } from 'vue';
import { applyDragSelection } from '../utils/rangeSelect.js';

/**
 * チェックボックスからのドラッグなぞり選択 Composable
 *
 * @param {object} options
 * @param {() => number[]} options.getOrderedIds - 表示順の部品ID配列を返す関数
 * @param {import('vue').Ref<number[]>} options.selectedParts - 現在選択中の部品ID配列 ref
 * @param {import('vue').Ref<number|null>} options.selectionAnchorId - 範囲選択の起点ID ref
 * @param {import('vue').Ref<boolean>} [options.isMobileView] - モバイル表示フラグ
 */
export function useDragSelect({
  getOrderedIds,
  selectedParts,
  selectionAnchorId,
  isMobileView
}) {
  const isDragging = ref(false);

  let startId = null;
  let currentId = null;
  let baseline = [];
  let selectMode = true;
  let hasActivated = false;
  let suppressNextClick = false;

  let lastClientX = 0;
  let lastClientY = 0;
  let rafMoveId = null;
  let scrollRafId = null;
  let listenersAttached = false;

  const TOP_BAR_HEIGHT = 52;
  const EDGE_THRESHOLD = 40;

  const updateSelectionAt = (clientX, clientY) => {
    if (typeof document === 'undefined') return;

    const el = document.elementFromPoint(clientX, clientY)?.closest('[data-part-id]');
    if (!el) return;

    const partId = Number(el.dataset.partId);
    if (!partId) return;

    if (!hasActivated && partId !== startId) {
      hasActivated = true;
      isDragging.value = true;
    }

    if (hasActivated) {
      currentId = partId;
      selectedParts.value = applyDragSelection({
        orderedIds: getOrderedIds(),
        baseline,
        startId,
        currentId,
        select: selectMode
      });
    }
  };

  const stopAutoScroll = () => {
    if (scrollRafId !== null) {
      cancelAnimationFrame(scrollRafId);
      scrollRafId = null;
    }
  };

  const stepAutoScroll = () => {
    if (typeof window === 'undefined') return;

    const y = lastClientY;
    const innerHeight = window.innerHeight;
    let scrollDelta = 0;

    const topEdge = TOP_BAR_HEIGHT + EDGE_THRESHOLD;
    if (y >= 0 && y <= topEdge) {
      const ratio = Math.max(0, Math.min(1, (topEdge - y) / EDGE_THRESHOLD));
      scrollDelta = -Math.round(4 + ratio * 12);
    } else if (y >= innerHeight - EDGE_THRESHOLD && y <= innerHeight) {
      const ratio = Math.max(0, Math.min(1, (y - (innerHeight - EDGE_THRESHOLD)) / EDGE_THRESHOLD));
      scrollDelta = Math.round(4 + ratio * 12);
    }

    if (scrollDelta !== 0) {
      window.scrollBy(0, scrollDelta);
      updateSelectionAt(lastClientX, lastClientY);
      scrollRafId = requestAnimationFrame(stepAutoScroll);
    } else {
      scrollRafId = null;
    }
  };

  const checkAutoScroll = () => {
    if (typeof window === 'undefined') return;
    const y = lastClientY;
    const innerHeight = window.innerHeight;
    const topEdge = TOP_BAR_HEIGHT + EDGE_THRESHOLD;

    const inScrollZone =
      (y >= 0 && y <= topEdge) ||
      (y >= innerHeight - EDGE_THRESHOLD && y <= innerHeight);

    if (inScrollZone && scrollRafId === null) {
      scrollRafId = requestAnimationFrame(stepAutoScroll);
    } else if (!inScrollZone && scrollRafId !== null) {
      stopAutoScroll();
    }
  };

  const onPointerMove = (event) => {
    lastClientX = event.clientX;
    lastClientY = event.clientY;

    if (rafMoveId !== null) {
      cancelAnimationFrame(rafMoveId);
    }
    rafMoveId = requestAnimationFrame(() => {
      rafMoveId = null;
      updateSelectionAt(lastClientX, lastClientY);
      if (hasActivated) {
        checkAutoScroll();
      }
    });
  };

  const detachListeners = () => {
    if (!listenersAttached || typeof window === 'undefined') return;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('keydown', onKeyDown);
    listenersAttached = false;
  };

  const cleanup = () => {
    detachListeners();
    if (rafMoveId !== null) {
      cancelAnimationFrame(rafMoveId);
      rafMoveId = null;
    }
    stopAutoScroll();
  };

  const onPointerUp = () => {
    cleanup();
    if (hasActivated) {
      suppressNextClick = true;
      setTimeout(() => {
        suppressNextClick = false;
      }, 0);
      if (selectionAnchorId && currentId !== null) {
        selectionAnchorId.value = currentId;
      }
    }
    isDragging.value = false;
  };

  const onPointerCancel = () => {
    cleanup();
    isDragging.value = false;
  };

  const onBlur = () => {
    cleanup();
    isDragging.value = false;
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      cleanup();
      selectedParts.value = [...baseline];
      isDragging.value = false;
      event.preventDefault();
    }
  };

  const start = (event, id) => {
    // マウス左ボタン、非Shift、非モバイル表示のみ開始可能（D5）
    const isLeftMouse = event.pointerType === 'mouse' && event.button === 0;
    if (!isLeftMouse || event.shiftKey) return;
    if (isMobileView && isMobileView.value) return;

    cleanup();

    startId = id;
    currentId = id;
    baseline = [...selectedParts.value];
    selectMode = !selectedParts.value.includes(id);
    hasActivated = false;
    isDragging.value = false;

    lastClientX = event.clientX;
    lastClientY = event.clientY;

    if (typeof window !== 'undefined') {
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);
      window.addEventListener('blur', onBlur);
      window.addEventListener('keydown', onKeyDown);
      listenersAttached = true;
    }
  };

  const cancel = () => {
    cleanup();
    isDragging.value = false;
  };

  const consumeSuppressedClick = () => {
    if (suppressNextClick) {
      suppressNextClick = false;
      return true;
    }
    return false;
  };

  onUnmounted(() => {
    cleanup();
  });

  return {
    isDragging,
    start,
    cancel,
    consumeSuppressedClick
  };
}
