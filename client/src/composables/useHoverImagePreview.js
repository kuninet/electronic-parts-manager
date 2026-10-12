import { ref, onUnmounted } from 'vue';
import { computeHoverPreviewPosition } from '../utils/hoverPreview.js';

/**
 * 写真ホバー拡大プレビューの状態管理コンポーザブル
 *
 * @param {object} [options]
 * @param {number} [options.delayMs=250] ホバー開始から表示までの遅延（ミリ秒）
 * @param {{width:number, height:number}} [options.size={width:480, height:480}] 拡大ポップアップの希望サイズ
 */
export function useHoverImagePreview({ delayMs = 250, size = { width: 480, height: 480 } } = {}) {
  const preview = ref({
    visible: false,
    src: '',
    caption: '',
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    side: 'left'
  });

  let timer = null;

  const supportsHover = () => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  };

  const hide = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    preview.value.visible = false;
  };

  const schedule = (event, { src, caption } = {}) => {
    if (!supportsHover()) return;
    hide();

    const target = event?.currentTarget;
    if (!target || typeof target.getBoundingClientRect !== 'function') return;

    // 遅延の前に呼び出し元要素の矩形を取得
    const rect = target.getBoundingClientRect();

    timer = setTimeout(() => {
      timer = null;
      if (typeof window === 'undefined') return;

      const viewport = {
        width: window.innerWidth,
        height: window.innerHeight
      };

      const pos = computeHoverPreviewPosition({
        rect,
        viewport,
        size
      });

      preview.value = {
        visible: true,
        src: src || '',
        caption: caption || '',
        left: pos.left,
        top: pos.top,
        width: pos.width,
        height: pos.height,
        side: pos.side
      };
    }, delayMs);
  };

  const onWindowBlur = () => {
    hide();
  };

  const onVisibilityChange = () => {
    if (document.hidden) {
      hide();
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      hide();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('keydown', onKeyDown);
  }

  onUnmounted(() => {
    hide();
    if (typeof window !== 'undefined') {
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('keydown', onKeyDown);
    }
  });

  return {
    preview,
    schedule,
    hide,
    supportsHover
  };
}
