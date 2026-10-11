import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  THEMES,
  THEME_STORAGE_KEY,
  getStoredTheme,
  resolveEffectiveTheme,
  getNextTheme,
  normalizeTheme
} from '../utils/theme';

// アプリケーション全体で状態を共有するシングルトン ref
const currentTheme = ref(getStoredTheme());

/**
 * 実際にDOMにテーマ属性を反映
 */
function applyToDocument(effectiveTheme) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', effectiveTheme);
    // iOS Safari等のアドレスバー背景色連動用
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute(
        'content',
        effectiveTheme === THEMES.LIGHT ? '#f1f5f9' : '#0f172a'
      );
    }
  }
}

// 初期反映
if (typeof window !== 'undefined') {
  applyToDocument(resolveEffectiveTheme(currentTheme.value));
}

export function useTheme() {
  const theme = computed(() => currentTheme.value);

  const effectiveTheme = computed(() => {
    return resolveEffectiveTheme(currentTheme.value);
  });

  const setTheme = (newTheme) => {
    const valid = normalizeTheme(newTheme);
    currentTheme.value = valid;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(THEME_STORAGE_KEY, valid);
    }
    applyToDocument(resolveEffectiveTheme(valid));
  };

  const cycleTheme = () => {
    const next = getNextTheme(currentTheme.value);
    setTheme(next);
  };

  // システムカラー変更の監視リスナー（system選択時のみ再計算）
  let mediaQuery = null;
  const handleSystemThemeChange = () => {
    if (currentTheme.value === THEMES.SYSTEM) {
      applyToDocument(resolveEffectiveTheme(THEMES.SYSTEM));
    }
  };

  onMounted(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', handleSystemThemeChange);
      } else if (mediaQuery.addListener) {
        mediaQuery.addListener(handleSystemThemeChange);
      }
    }
    // マウント時にも最新状態を反映
    applyToDocument(effectiveTheme.value);
  });

  onUnmounted(() => {
    if (mediaQuery) {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleSystemThemeChange);
      } else if (mediaQuery.removeListener) {
        mediaQuery.removeListener(handleSystemThemeChange);
      }
    }
  });

  return {
    theme,
    effectiveTheme,
    setTheme,
    cycleTheme,
    THEMES
  };
}
