import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import {
  getApiToken,
  setApiToken,
  clearApiToken,
  isApiTokenRequiredError,
  API_TOKEN_KEY
} from '../src/utils/apiToken.js';
import {
  useApiTokenPrompt,
  requestApiToken,
  submitApiToken,
  cancelApiTokenPrompt
} from '../src/composables/useApiTokenPrompt.js';
import { installApiTokenInterceptors } from '../src/utils/apiTokenInterceptors.js';

// localStorage のモック
class MockLocalStorage {
  constructor() {
    this.store = {};
    this.throwOnAccess = false;
  }
  getItem(key) {
    if (this.throwOnAccess) throw new Error('QuotaExceeded or disabled');
    return this.store[key] ?? null;
  }
  setItem(key, value) {
    if (this.throwOnAccess) throw new Error('QuotaExceeded or disabled');
    this.store[key] = String(value);
  }
  removeItem(key) {
    if (this.throwOnAccess) throw new Error('QuotaExceeded or disabled');
    delete this.store[key];
  }
  clear() {
    if (this.throwOnAccess) throw new Error('QuotaExceeded or disabled');
    this.store = {};
  }
}

describe('API トークン 単体テスト (K-1 〜 K-10)', () => {
  let mockStorage;

  beforeEach(() => {
    mockStorage = new MockLocalStorage();
    globalThis.localStorage = mockStorage;
    cancelApiTokenPrompt(); // 残留プロンプトをクリア
  });

  test('K-1: localStorage が空のとき getApiToken() は null', () => {
    assert.equal(getApiToken(), null);
  });

  test('K-2: setApiToken("t") 後に getApiToken() は "t"', () => {
    setApiToken('t');
    assert.equal(getApiToken(), 't');
  });

  test('K-3: localStorage が例外を投げても get/set/clear は例外を出さない（get は null）', () => {
    mockStorage.throwOnAccess = true;
    assert.doesNotThrow(() => getApiToken());
    assert.equal(getApiToken(), null);
    assert.doesNotThrow(() => setApiToken('test'));
    assert.doesNotThrow(() => clearApiToken());
  });

  test('K-4: isApiTokenRequiredError の判定', () => {
    const errRequired = {
      response: {
        status: 401,
        data: { error: 'Unauthorized', code: 'API_TOKEN_REQUIRED' }
      }
    };
    assert.equal(isApiTokenRequiredError(errRequired), true);

    const errBasicAuth = {
      response: {
        status: 401,
        data: { error: 'Unauthorized' }
      }
    };
    assert.equal(isApiTokenRequiredError(errBasicAuth), false);

    const err403 = {
      response: {
        status: 403,
        data: { error: 'Forbidden' }
      }
    };
    assert.equal(isApiTokenRequiredError(err403), false);

    assert.equal(isApiTokenRequiredError(null), false);
  });

  test('K-5: トークン保存時、リクエストに Authorization: Bearer <token> が付与される', async () => {
    setApiToken('my-token');
    let capturedConfig = null;

    const instance = axios.create({
      adapter: async (config) => {
        capturedConfig = config;
        return { status: 200, data: { ok: true }, headers: {}, config };
      }
    });
    installApiTokenInterceptors(instance);

    await instance.get('/test');
    assert.ok(capturedConfig);
    assert.equal(capturedConfig.headers.Authorization, 'Bearer my-token');
  });

  test('K-6: トークンが無い場合、Authorization ヘッダーは付与されない', async () => {
    clearApiToken();
    let capturedConfig = null;

    const instance = axios.create({
      adapter: async (config) => {
        capturedConfig = config;
        return { status: 200, data: { ok: true }, headers: {}, config };
      }
    });
    installApiTokenInterceptors(instance);

    await instance.get('/test');
    assert.ok(capturedConfig);
    assert.equal(capturedConfig.headers.Authorization, undefined);
  });

  test('K-7: 1回目401（API_TOKEN_REQUIRED）→ submitApiToken("t") → 1回だけ再送されて200で解決する', async () => {
    clearApiToken();
    let attempts = 0;
    const { state } = useApiTokenPrompt();

    const instance = axios.create({
      adapter: async (config) => {
        attempts++;
        if (attempts === 1) {
          const err = new Error('Request failed with status code 401');
          err.response = {
            status: 401,
            data: { error: 'Unauthorized', code: 'API_TOKEN_REQUIRED' }
          };
          err.config = config;
          throw err;
        }
        return { status: 200, data: { success: true }, headers: {}, config };
      }
    });
    installApiTokenInterceptors(instance);

    const reqPromise = instance.get('/parts');

    // プロンプトが開くのを待つ
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(state.open, true);

    // トークンを入力して送信
    setApiToken('valid-token');
    submitApiToken('valid-token');

    const res = await reqPromise;
    assert.equal(res.status, 200);
    assert.equal(attempts, 2);
    assert.equal(state.open, false);
  });

  test('K-8: 同時に3リクエストが401になってもプロンプトPromiseは1つだけで、全て再送解決する', async () => {
    clearApiToken();
    let attempts = 0;
    const { state } = useApiTokenPrompt();

    const instance = axios.create({
      adapter: async (config) => {
        attempts++;
        if (!config._tokenRetried) {
          const err = new Error('Unauthorized');
          err.response = {
            status: 401,
            data: { error: 'Unauthorized', code: 'API_TOKEN_REQUIRED' }
          };
          err.config = config;
          throw err;
        }
        return { status: 200, data: { path: config.url }, headers: {}, config };
      }
    });
    installApiTokenInterceptors(instance);

    const p1 = instance.get('/req1');
    const p2 = instance.get('/req2');
    const p3 = instance.get('/req3');

    await new Promise((r) => setTimeout(r, 10));
    assert.equal(state.open, true);

    submitApiToken('shared-token');

    const results = await Promise.all([p1, p2, p3]);
    assert.equal(results.length, 3);
    for (const r of results) {
      assert.equal(r.status, 200);
    }
    assert.equal(attempts, 6); // 3回失敗 + 3回再送成功
  });

  test('K-9: 再送も401の場合、clearApiTokenされerrorMessageが「トークンが違います」になり、キャンセルで元のエラーでreject、3回目は送らない', async () => {
    setApiToken('initial-wrong-token');
    let attempts = 0;
    const { state } = useApiTokenPrompt();

    const instance = axios.create({
      adapter: async (config) => {
        attempts++;
        const err = new Error('Unauthorized');
        err.response = {
          status: 401,
          data: { error: 'Unauthorized', code: 'API_TOKEN_REQUIRED' }
        };
        err.config = config;
        throw err;
      }
    });
    installApiTokenInterceptors(instance);

    const reqPromise = instance.get('/parts');

    // 1回目の401でプロンプトが開く
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(state.open, true);

    // 2回目のトークンを入力して送信（これも401になる）
    submitApiToken('second-wrong-token');

    // 2回目の401が発生し、errorMessageが設定され、clearApiTokenされるのを待つ
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(getApiToken(), null);
    assert.equal(state.errorMessage, 'トークンが違います');
    assert.equal(state.open, true);

    // キャンセルする
    cancelApiTokenPrompt();

    await assert.rejects(reqPromise, (err) => {
      assert.equal(err.response?.status, 401);
      return true;
    });

    assert.equal(attempts, 2); // 1回目 + 再送1回 = 計2回（3回目は送らない）
  });

  test('K-10: code の無い 401（CloudFront Basic認証など）ではダイアログは開かず即座に reject', async () => {
    const { state } = useApiTokenPrompt();

    const instance = axios.create({
      adapter: async (config) => {
        const err = new Error('Unauthorized');
        err.response = {
          status: 401,
          data: { error: 'Unauthorized' } // code なし
        };
        err.config = config;
        throw err;
      }
    });
    installApiTokenInterceptors(instance);

    await assert.rejects(instance.get('/parts'), (err) => {
      assert.equal(err.response?.status, 401);
      return true;
    });

    assert.equal(state.open, false);
  });
});
