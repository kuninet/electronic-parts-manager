import { onMounted, onUnmounted } from 'vue';
import { registerServiceWorker } from '../pwa/registerServiceWorker';
import { decideUpdateAction, isValidBuildId, shouldCheck } from '../utils/updatePolicy';
import { useToast } from './useToast';

const STORAGE_KEY = 'epm_update_guard';

function getGuard() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function setGuard(guard) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(guard));
  } catch (e) {}
}

function clearGuard() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch (e) {}
}

function isStorageAvailable() {
  try {
    const testKey = '__test_storage__';
    sessionStorage.setItem(testKey, '1');
    sessionStorage.removeItem(testKey);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * PWA の新バージョン検知と適用管理
 * @param {object} options
 * @param {() => boolean} [options.isBusy] モーダル表示や入力中などのビジー状態判定関数
 */
export function useAppUpdate({ isBusy = () => false } = {}) {
  const toast = useToast();
  const currentBuildId = typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : 'dev';

  let wb = null;
  let inFlight = false;
  let lastCheckedAt = 0;
  let initialController = null;
  const notifiedBuildIds = new Set();

  // 初期化時に初期コントローラーを記録
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    initialController = navigator.serviceWorker.controller ?? null;
  }

  // 起動時に現在のビルドが以前の targetBuildId と一致していればガードを解除
  const existingGuard = getGuard();
  if (existingGuard && existingGuard.targetBuildId === currentBuildId) {
    clearGuard();
  }

  /**
   * 更新通知トーストを表示（更新ボタン付き）
   */
  const notifyUser = (latestBuildId, { fromSwActivated = false } = {}) => {
    if (notifiedBuildIds.has(latestBuildId)) return;
    notifiedBuildIds.add(latestBuildId);

    toast.show({
      message: '新しいバージョンがあります',
      type: 'info',
      duration: 0,
      action: {
        label: '更新',
        onClick: () => {
          // ユーザー手動による更新（isBusy チェックを除外して即時適用）
          applyUpdate(latestBuildId, { fromSwActivated, forceReload: true });
        }
      }
    });
  };

  /**
   * コントローラーの切り替えを待機する
   * @param {number} timeoutMs
   * @returns {Promise<boolean>} 新しいSWに切り替わったか
   */
  const waitForControllerChange = (timeoutMs = 8000) => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return Promise.resolve(false);
    }
    // 待機前に既に controller が変わっていれば待たずに即 true
    if (navigator.serviceWorker.controller && navigator.serviceWorker.controller !== initialController) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      let done = false;
      let timer = null;

      const onControllerChange = () => {
        if (!done) {
          done = true;
          if (timer) clearTimeout(timer);
          navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
          resolve(true);
        }
      };

      timer = setTimeout(() => {
        if (!done) {
          done = true;
          navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
          resolve(false);
        }
      }, timeoutMs);

      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    });
  };

  /**
   * 更新の適用処理
   * @param {string} latestBuildId
   * @param {object} [options]
   * @param {boolean} [options.fromSwActivated]
   * @param {boolean} [options.forceReload] 手動クリック経路など、ビジー再確認を除外する場合 true
   */
  const applyUpdate = async (latestBuildId, { fromSwActivated = false, forceReload = false } = {}) => {
    let switched = false;

    // 1) 新SWのアクティベートを待つ
    if (fromSwActivated) {
      switched = true;
    } else if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      // 待機前に既に controller が変わっているか判定
      if (navigator.serviceWorker.controller && navigator.serviceWorker.controller !== initialController) {
        switched = true;
      } else {
        // 待機が発生する場合はトーストを表示 (m-3)
        toast.info('更新しています…', 2000);
        switched = await waitForControllerChange(8000);
      }
    }

    // 2) 新しい SW に切り替わらなかった場合だけ workbox-precache を削除 (M-1)
    if (!switched && 'caches' in window) {
      try {
        const keys = await caches.keys();
        for (const key of keys) {
          if (key.startsWith('workbox-precache')) {
            await caches.delete(key);
          }
        }
      } catch (e) {}
    }

    // 3) reload() 直前で isBusy() を再確認（手動経路では除外） (M-2)
    if (!forceReload && typeof isBusy === 'function' && isBusy()) {
      notifyUser(latestBuildId, { fromSwActivated });
      return;
    }

    // 4) 再読み込み前にガードを記録
    const guard = getGuard();
    const attempts = guard && guard.targetBuildId === latestBuildId ? (guard.attempts || 0) + 1 : 1;
    setGuard({ targetBuildId: latestBuildId, attempts, at: Date.now() });

    window.location.reload();
  };

  const handleUpdateFound = (latestBuildId, { fromSwActivated = false } = {}) => {
    const guard = getGuard();
    const busy = typeof isBusy === 'function' ? isBusy() : false;
    const action = decideUpdateAction({
      currentBuildId,
      latestBuildId,
      guard,
      busy,
      storageAvailable: isStorageAvailable()
    });

    if (action === 'none') {
      return;
    }

    if (action === 'give-up') {
      if (!notifiedBuildIds.has(latestBuildId)) {
        toast.warning('最新版を取得できませんでした。アプリを終了して起動し直してください。', 0);
        notifiedBuildIds.add(latestBuildId);
      }
      return;
    }

    if (action === 'notify') {
      notifyUser(latestBuildId, { fromSwActivated });
      return;
    }

    if (action === 'reload') {
      applyUpdate(latestBuildId, { fromSwActivated, forceReload: false });
    }
  };

  const checkForUpdate = async ({ force = false, fromSwActivated = false } = {}) => {
    if (import.meta.env.DEV) return;

    // force でない場合は 60 秒間隔制御を行う (m-2)
    if (!force && !shouldCheck({
      now: Date.now(),
      lastCheckedAt,
      inFlight,
      online: typeof navigator !== 'undefined' ? navigator.onLine : true
    })) {
      return;
    }

    // 通信中またはオフライン時はスキップ
    if (inFlight) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    inFlight = true;
    lastCheckedAt = Date.now();

    try {
      if (wb && typeof wb.update === 'function') {
        wb.update().catch(() => {});
      }

      const res = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;

      const data = await res.json();
      if (!data || !isValidBuildId(data.buildId)) return;

      if (data.buildId === currentBuildId) {
        clearGuard();
        return;
      }

      handleUpdateFound(data.buildId, { fromSwActivated });
    } catch (e) {
      // ネットワークエラー・JSON不正等は無視して静かに終了
    } finally {
      inFlight = false;
    }
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      checkForUpdate();
    }
  };

  const onPreloadError = (event) => {
    event.preventDefault();
    // 遅延チャンク読み込み失敗時は間隔制御を通さずに更新確認を実行 (m-2)
    checkForUpdate({ force: true });
  };

  onMounted(() => {
    if (import.meta.env.DEV) return;

    // onMounted 時点でも initialController を確認・保持
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && !initialController) {
      initialController = navigator.serviceWorker.controller ?? null;
    }

    wb = registerServiceWorker({
      onUpdateActivated: () => {
        // 新SWが有効化されたら間隔制御を通さず、fromSwActivated: true で更新確認・適用フローを呼び出し (m-2)
        checkForUpdate({ force: true, fromSwActivated: true });
      }
    });

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('vite:preloadError', onPreloadError);

    // 起動時の初期更新チェック
    checkForUpdate();
  });

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('vite:preloadError', onPreloadError);
  });

  return {
    checkForUpdate,
    applyUpdate
  };
}
