export const API_TOKEN_KEY = 'epm-api-token';

/**
 * 保存されている API トークンを取得する
 * @returns {string|null}
 */
export function getApiToken() {
  try {
    return localStorage.getItem(API_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * API トークンを保存する
 * @param {string} token
 */
export function setApiToken(token) {
  try {
    if (token) {
      localStorage.setItem(API_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(API_TOKEN_KEY);
    }
  } catch {}
}

/**
 * 保存されている API トークンを削除する
 */
export function clearApiToken() {
  try {
    localStorage.removeItem(API_TOKEN_KEY);
  } catch {}
}

/**
 * サーバーが API トークンを要求している 401 エラーかどうかを判定する
 * @param {any} error
 * @returns {boolean}
 */
export function isApiTokenRequiredError(error) {
  return error?.response?.status === 401 && error?.response?.data?.code === 'API_TOKEN_REQUIRED';
}
