export const AUTO_NAME_PREFIXES = ['(名称未設定)', '(カメラ登録)'];
export const LOW_STOCK_THRESHOLD = 5;

/**
 * 部品名が自動生成された仮名（未設定またはカメラ登録時プレースホルダ）かどうかを判定する
 * @param {string} name
 * @returns {boolean}
 */
export function isAutoNamed(name) {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  return AUTO_NAME_PREFIXES.some(prefix => trimmed.startsWith(prefix));
}
