const test = require('node:test');
const assert = require('node:assert/strict');
const { isAutoNamed, AUTO_NAME_PREFIXES } = require('../utils/autoName');

test('autoName定数とヘルパー関数のテスト', async (t) => {
  await t.test('AUTO_NAME_PREFIXESに期待されるプレフィックスが含まれること', () => {
    assert.deepEqual(AUTO_NAME_PREFIXES, ['(名称未設定)', '(カメラ登録)']);
  });

  await t.test('isAutoNamedが仮名プレフィックスで始まる部品名に対してtrueを返すこと', () => {
    assert.equal(isAutoNamed('(名称未設定)'), true);
    assert.equal(isAutoNamed('(名称未設定) 2026-03-01 12:00:00'), true);
    assert.equal(isAutoNamed('  (名称未設定)  '), true);
    assert.equal(isAutoNamed('(カメラ登録)'), true);
    assert.equal(isAutoNamed('(カメラ登録) 2026-03-01 12:00:00'), true);
    assert.equal(isAutoNamed('  (カメラ登録) 123  '), true);
  });

  await t.test('isAutoNamedが通常の部品名に対してfalseを返すこと', () => {
    assert.equal(isAutoNamed('2SC1815'), false);
    assert.equal(isAutoNamed('積層セラミックコンデンサ 0.1uF'), false);
    assert.equal(isAutoNamed('NE555P'), false);
    assert.equal(isAutoNamed('カメラモジュール'), false);
    assert.equal(isAutoNamed('設定済み抵抗器'), false);
  });

  await t.test('isAutoNamedが無効な入力に対してfalseを返すこと', () => {
    assert.equal(isAutoNamed(''), false);
    assert.equal(isAutoNamed('   '), false);
    assert.equal(isAutoNamed(null), false);
    assert.equal(isAutoNamed(undefined), false);
    assert.equal(isAutoNamed(123), false);
    assert.equal(isAutoNamed({}), false);
  });
});
