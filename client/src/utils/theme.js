/**
 * テーマ関連のユーティリティ定数と判定ロジック
 */

export const THEMES = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system'
};

export const THEME_STORAGE_KEY = 'epm_theme';

/**
 * 有効なテーマ設定値か検証・正規化
 * @param {string} theme 
 * @returns {'light' | 'dark' | 'system'}
 */
export function normalizeTheme(theme) {
  if (theme === THEMES.LIGHT || theme === THEMES.DARK || theme === THEMES.SYSTEM) {
    return theme;
  }
  return THEMES.SYSTEM;
}

/**
 * システムのカラー設定（prefers-color-scheme）から dark または light を判定
 * @returns {'dark' | 'light'}
 */
export function getSystemTheme() {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? THEMES.DARK
      : THEMES.LIGHT;
  }
  return THEMES.DARK;
}

/**
 * 保存されたテーマ設定値を取得（未設定時は system）
 * @returns {'light' | 'dark' | 'system'}
 */
export function getStoredTheme() {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return normalizeTheme(stored);
  }
  return THEMES.SYSTEM;
}

/**
 * ユーザー指定（light | dark | system）から実際に適用するテーマ（light | dark）を解決
 * @param {string} themePreference 
 * @returns {'dark' | 'light'}
 */
export function resolveEffectiveTheme(themePreference) {
  const norm = normalizeTheme(themePreference);
  if (norm === THEMES.SYSTEM) {
    return getSystemTheme();
  }
  return norm;
}

/**
 * 次のテーマ設定値へ循環
 * system -> dark -> light -> system
 * @param {string} currentTheme 
 * @returns {'light' | 'dark' | 'system'}
 */
export function getNextTheme(currentTheme) {
  const norm = normalizeTheme(currentTheme);
  switch (norm) {
    case THEMES.SYSTEM:
      return THEMES.DARK;
    case THEMES.DARK:
      return THEMES.LIGHT;
    case THEMES.LIGHT:
    default:
      return THEMES.SYSTEM;
  }
}
