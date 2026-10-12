/**
 * PWA 更新判定ポリシー（純粋関数群・DOM非依存）
 */

/**
 * ビルド識別子の妥当性検証
 * 空でない文字列かつ200文字以下であること
 * @param {any} value
 * @returns {boolean}
 */
export function isValidBuildId(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (value.length > 200) return false;
  return true;
}

/**
 * 更新チェックを実行すべきかの判定
 * @param {object} params
 * @param {number} [params.now] 現在時刻（ミリ秒）
 * @param {number} [params.lastCheckedAt] 最終チェック時刻（ミリ秒）
 * @param {boolean} [params.inFlight] チェック処理が実行中か
 * @param {boolean} [params.online] オンライン状態か
 * @param {number} [params.minIntervalMs] 最小インターバル（既定: 60000ms）
 * @returns {boolean}
 */
export function shouldCheck({
  now = Date.now(),
  lastCheckedAt = 0,
  inFlight = false,
  online = true,
  minIntervalMs = 60000
} = {}) {
  if (inFlight) return false;
  if (!online) return false;
  if (lastCheckedAt > 0 && now - lastCheckedAt < minIntervalMs) return false;
  return true;
}

/**
 * 更新アクションの決定
 * @param {object} params
 * @param {string} params.currentBuildId 現在稼働中のビルド識別子
 * @param {string} params.latestBuildId サーバーから取得した最新のビルド識別子
 * @param {object|null} [params.guard] セッションストレージ等に記録されたガード情報 { targetBuildId, attempts, at }
 * @param {boolean} [params.busy] 編集中またはQR画面などのビジー状態か
 * @param {boolean} [params.storageAvailable] ストレージ利用可否（不可時は安全側に倒して通知のみ）
 * @returns {'none' | 'reload' | 'notify' | 'give-up'}
 */
export function decideUpdateAction({
  currentBuildId,
  latestBuildId,
  guard = null,
  busy = false,
  storageAvailable = true
}) {
  if (!isValidBuildId(latestBuildId) || latestBuildId === currentBuildId) {
    return 'none';
  }

  // ストレージが利用できない場合はリロードループ防止の記録ができないため通知のみ
  if (!storageAvailable) {
    return 'notify';
  }

  // 同じ targetBuildId に対して既にリロードを試みていた場合は諦める（give-up）
  if (guard && guard.targetBuildId === latestBuildId && (guard.attempts || 0) >= 1) {
    return 'give-up';
  }

  // 編集中やダイアログ表示中、QR画面などの場合は通知のみ
  if (busy) {
    return 'notify';
  }

  return 'reload';
}
