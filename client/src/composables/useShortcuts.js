import { onMounted, onUnmounted } from 'vue';

export function useShortcuts({ onSearch, onNew, isBlocked }) {
  const handleKeyDown = (e) => {
    // IME変換中または未確定状態
    if (e.isComposing || e.keyCode === 229) {
      return;
    }

    // フォーム入力欄またはcontenteditableにフォーカスがある場合
    const target = e.target;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }

    // モーダル等でブロックされている場合
    if (typeof isBlocked === 'function' && isBlocked()) {
      return;
    }

    // Altキーが押されている場合は無視
    if (e.altKey) {
      return;
    }

    // / または ⌘K / Ctrl+K で検索欄フォーカス
    const isCmdK = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K');
    const isSlash = !e.metaKey && !e.ctrlKey && e.key === '/';

    if (isCmdK || isSlash) {
      e.preventDefault();
      if (typeof onSearch === 'function') {
        onSearch();
      }
      return;
    }

    // 修飾キーなしの 'n' で新規パーツ追加
    if (!e.metaKey && !e.ctrlKey && !e.shiftKey && (e.key === 'n' || e.key === 'N')) {
      e.preventDefault();
      if (typeof onNew === 'function') {
        onNew();
      }
    }
  };

  onMounted(() => {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handleKeyDown);
    }
  });

  onUnmounted(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleKeyDown);
    }
  });
}
