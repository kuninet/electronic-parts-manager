import { reactive } from 'vue';

const state = reactive({
  open: false,
  errorMessage: ''
});

let pending = null;

/**
 * ユーザーに API トークンの入力を促すプロンプトを開き、入力を待つ Promise を返す
 * 複数リクエストが同時に 401 になった場合でも、単一の共有 Promise を返す
 * 
 * @param {Object} [options]
 * @param {boolean} [options.invalid=false] - 直前のトークンが誤っていた場合 true
 * @returns {Promise<string>}
 */
export function requestApiToken({ invalid = false } = {}) {
  state.open = true;
  state.errorMessage = invalid ? 'トークンが違います' : '';

  if (pending) {
    return pending.promise;
  }

  let resolveFn;
  let rejectFn;
  const promise = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  pending = {
    promise,
    resolve: resolveFn,
    reject: rejectFn
  };

  return promise;
}

/**
 * ユーザーが入力したトークンを確定し、待機中のリクエストを再開する
 * @param {string} token
 */
export function submitApiToken(token) {
  state.open = false;
  state.errorMessage = '';
  if (pending) {
    const current = pending;
    pending = null;
    current.resolve(token);
  }
}

/**
 * ユーザーがトークン入力をキャンセルしたため、待機中のリクエストを中断する
 */
export function cancelApiTokenPrompt() {
  state.open = false;
  state.errorMessage = '';
  if (pending) {
    const current = pending;
    pending = null;
    current.reject(new Error('API_TOKEN_PROMPT_CANCELLED'));
  }
}

/**
 * API トークンプロンプトのコンポーザブル
 */
export function useApiTokenPrompt() {
  return {
    state,
    requestApiToken,
    submitApiToken,
    cancelApiTokenPrompt
  };
}
