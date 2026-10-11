import test from 'node:test';
import assert from 'node:assert/strict';
import { useToast } from '../src/composables/useToast.js';

test('useToast - 基本操作（追加・消去・クリア）', () => {
  const toast = useToast();
  toast.clearAll();
  assert.equal(toast.toasts.value.length, 0);

  // 1件追加
  const id1 = toast.success('成功メッセージ');
  assert.equal(toast.toasts.value.length, 1);
  assert.equal(toast.toasts.value[0].message, '成功メッセージ');
  assert.equal(toast.toasts.value[0].type, 'success');

  // エラー追加（duration 4500ms デフォルト）
  const id2 = toast.error('エラーメッセージ');
  assert.equal(toast.toasts.value.length, 2);
  assert.equal(toast.toasts.value[1].type, 'error');
  assert.equal(toast.toasts.value[1].duration, 4500);

  // 個別消去
  toast.dismiss(id1);
  assert.equal(toast.toasts.value.length, 1);
  assert.equal(toast.toasts.value[0].id, id2);

  // 全消去
  toast.clearAll();
  assert.equal(toast.toasts.value.length, 0);
});

test('useToast - 最大件数制限（5件）', () => {
  const toast = useToast();
  toast.clearAll();

  for (let i = 1; i <= 7; i++) {
    toast.info(`メッセージ ${i}`);
  }

  // 最大5件に抑えられ、古いもの（1, 2）が押し出される
  assert.equal(toast.toasts.value.length, 5);
  assert.equal(toast.toasts.value[0].message, 'メッセージ 3');
  assert.equal(toast.toasts.value[4].message, 'メッセージ 7');

  toast.clearAll();
});
