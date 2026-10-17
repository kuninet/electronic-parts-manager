import { getApiToken, clearApiToken, isApiTokenRequiredError } from './apiToken.js';
import { requestApiToken } from '../composables/useApiTokenPrompt.js';

/**
 * Axios インスタンスに API トークン用の Request / Response インターセプターを組み込む
 * 
 * @param {import('axios').AxiosInstance} instance
 * @param {Object} [deps]
 * @param {() => string|null} [deps.getToken]
 * @param {() => void} [deps.clearToken]
 * @param {(opts?: { invalid?: boolean }) => Promise<string>} [deps.requestToken]
 */
export function installApiTokenInterceptors(
  instance,
  {
    getToken = getApiToken,
    clearToken = clearApiToken,
    requestToken = requestApiToken
  } = {}
) {
  // Request: 保存済みトークンがあれば Authorization ヘッダーを付与
  instance.interceptors.request.use((config) => {
    const token = getToken();
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  // Response: 401 (API_TOKEN_REQUIRED) 発生時のダイアログ表示と再送
  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      if (!isApiTokenRequiredError(error)) {
        return Promise.reject(error);
      }

      const originalRequest = error.config || {};

      // 既に再送済みにもかかわらず 401 の場合（トークン誤り）
      if (originalRequest._tokenRetried) {
        clearToken();
        // エラーメッセージ付きでプロンプトを再表示。
        // キャンセル時は元のエラーで reject。再送は 1 回に制限するため 3 回目は送らず reject する
        return requestToken({ invalid: true })
          .then(() => Promise.reject(error))
          .catch(() => Promise.reject(error));
      }

      // 初回 401 の場合: プロンプトでトークン入力を待ち、1回だけ再送する
      try {
        const token = await requestToken({ invalid: false });
        originalRequest._tokenRetried = true;
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return instance(originalRequest);
      } catch {
        return Promise.reject(error);
      }
    }
  );

  return instance;
}
