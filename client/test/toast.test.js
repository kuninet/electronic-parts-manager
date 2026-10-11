import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { useToast } from '../src/composables/useToast.js';

describe('useToast Tests', () => {
  test('useToast - 基本操作（追加・消去・クリア）', () => {
    const toast = useToast();
    toast.clearAll();
    assert.equal(toast.toasts.value.length, 0);

    // 1件追加
    const id1 = toast.success('成功メッセージ');
    assert.equal(toast.toasts.value.length, 1);
    assert.equal(toast.toasts.value[0].message, '成功メッセージ');
    assert.equal(toast.toasts.value[0].type, 'success');
    assert.equal(toast.toasts.value[0].duration, 2500);

    // エラー追加（duration 5000ms デフォルト）
    const id2 = toast.error('エラーメッセージ');
    assert.equal(toast.toasts.value.length, 2);
    assert.equal(toast.toasts.value[1].type, 'error');
    assert.equal(toast.toasts.value[1].duration, 5000);

    // 個別消去
    toast.dismiss(id1);
    assert.equal(toast.toasts.value.length, 1);
    assert.equal(toast.toasts.value[0].id, id2);

    // 全消去
    toast.clearAll();
    assert.equal(toast.toasts.value.length, 0);
  });

  test('useToast - 最大件数制限（3件）', () => {
    const toast = useToast();
    toast.clearAll();

    for (let i = 1; i <= 7; i++) {
      toast.info(`メッセージ ${i}`);
    }

    // 最大3件に抑えられ、5, 6, 7 が残る
    assert.equal(toast.toasts.value.length, 3);
    assert.equal(toast.toasts.value[0].message, 'メッセージ 5');
    assert.equal(toast.toasts.value[1].message, 'メッセージ 6');
    assert.equal(toast.toasts.value[2].message, 'メッセージ 7');

    toast.clearAll();
  });

  test('useToast - pause と resume', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });

    const toast = useToast();
    toast.clearAll();

    const id = toast.info('一時停止テスト', 3000);
    assert.equal(toast.toasts.value.length, 1);

    // 1000ms 経過後に pause
    t.mock.timers.tick(1000);
    toast.pause(id);

    // さらに 3000ms 経過させても消えない
    t.mock.timers.tick(3000);
    assert.equal(toast.toasts.value.length, 1);

    // resume
    toast.resume(id);

    // 残り時間約2000ms。1500ms 経過時点ではまだ存在
    t.mock.timers.tick(1500);
    assert.equal(toast.toasts.value.length, 1);

    // 残りの 600ms 経過で消去される
    t.mock.timers.tick(600);
    assert.equal(toast.toasts.value.length, 0);

    toast.clearAll();
    t.mock.timers.reset();
  });
});
