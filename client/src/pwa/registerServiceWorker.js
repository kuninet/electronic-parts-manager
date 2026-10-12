import { Workbox } from 'workbox-window';

/**
 * Service Worker の登録
 * @param {object} options
 * @param {Function} [options.onUpdateActivated] 新しい SW がアクティベートされた時のコールバック
 * @returns {Workbox|null}
 */
export function registerServiceWorker({ onUpdateActivated } = {}) {
  // 開発環境または SW 非対応ブラウザでは何もしない
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) {
    return null;
  }

  const wb = new Workbox('/sw.js', { scope: '/' });

  wb.addEventListener('activated', (event) => {
    // 初回インストールでは何もしない。更新または別タブからの更新時のみ通知
    if (event.isUpdate || event.isExternal) {
      onUpdateActivated?.();
    }
  });

  wb.register().catch((err) => {
    console.warn('Service Worker 登録失敗:', err);
  });

  return wb;
}
