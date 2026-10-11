import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THEMES,
  THEME_STORAGE_KEY,
  normalizeTheme,
  getSystemTheme,
  resolveEffectiveTheme,
  getNextTheme
} from '../src/utils/theme.js';

test('THEMES 定数とストレージキー', () => {
  assert.equal(THEMES.LIGHT, 'light');
  assert.equal(THEMES.DARK, 'dark');
  assert.equal(THEMES.SYSTEM, 'system');
  assert.equal(THEME_STORAGE_KEY, 'epm_theme');
});

test('normalizeTheme - 有効なテーマ値の正規化', () => {
  assert.equal(normalizeTheme('light'), 'light');
  assert.equal(normalizeTheme('dark'), 'dark');
  assert.equal(normalizeTheme('system'), 'system');
  assert.equal(normalizeTheme(''), 'system');
  assert.equal(normalizeTheme(null), 'system');
  assert.equal(normalizeTheme(undefined), 'system');
  assert.equal(normalizeTheme('invalid-theme'), 'system');
});

test('getNextTheme - テーマ切り替えの循環順序', () => {
  // system -> dark -> light -> system
  assert.equal(getNextTheme('system'), 'dark');
  assert.equal(getNextTheme('dark'), 'light');
  assert.equal(getNextTheme('light'), 'system');
  // 不正値時は system からの遷移として動作
  assert.equal(getNextTheme('unknown'), 'dark');
});

test('resolveEffectiveTheme - 実効テーマの解決', () => {
  assert.equal(resolveEffectiveTheme('light'), 'light');
  assert.equal(resolveEffectiveTheme('dark'), 'dark');
  // window.matchMedia がない環境では 'dark' にフォールバック
  assert.equal(resolveEffectiveTheme('system'), 'dark');
});

test('getSystemTheme - 非ブラウザ環境でのフォールバック', () => {
  assert.equal(getSystemTheme(), 'dark');
});
