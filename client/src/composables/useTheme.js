import { ref, computed } from 'vue';
import {
  THEMES,
  THEME_STORAGE_KEY,
  THEME_COLORS,
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
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute(
        'content',
        effectiveTheme === THEMES.LIGHT ? THEME_COLORS.light : THEME_COLORS.dark
      );
    }
  }
}

function triggerThemeTransition() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (prefersReducedMotion) return;

  document.documentElement.classList.add('theme-transition');
  setTimeout(() => {
    document.documentElement.classList.remove('theme-transition');
  }, 200);
}

// 初期反映とリスナー登録（モジュール読み込み時に1回だけ）
if (typeof window !== 'undefined') {
  applyToDocument(resolveEffectiveTheme(currentTheme.value));

  window.addEventListener('storage', (e) => {
    if (e.key === THEME_STORAGE_KEY) {
      currentTheme.value = normalizeTheme(e.newValue);
      triggerThemeTransition();
      applyToDocument(resolveEffectiveTheme(currentTheme.value));
    }
  });

  if (window.matchMedia) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => {
      if (currentTheme.value === THEMES.SYSTEM) {
        triggerThemeTransition();
        applyToDocument(resolveEffectiveTheme(THEMES.SYSTEM));
      }
    };
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleSystemThemeChange);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleSystemThemeChange);
    }
  }
}

export function useTheme() {
  const theme = computed(() => currentTheme.value);

  const effectiveTheme = computed(() => {
    return resolveEffectiveTheme(currentTheme.value);
  });

  const setTheme = (newTheme) => {
    const valid = normalizeTheme(newTheme);
    currentTheme.value = valid;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(THEME_STORAGE_KEY, valid);
      }
    } catch {}
    triggerThemeTransition();
    applyToDocument(resolveEffectiveTheme(valid));
  };

  const cycleTheme = () => {
    const next = getNextTheme(currentTheme.value);
    setTheme(next);
  };

  return {
    theme,
    effectiveTheme,
    setTheme,
    cycleTheme,
    THEMES
  };
}
