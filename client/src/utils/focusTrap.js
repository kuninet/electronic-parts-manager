export const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// currentIndex: 現在フォーカス中の要素の添字（パネル外なら -1）
// 戻り値: 次にフォーカスする添字。count が 0 なら -1
export function nextTrapIndex(currentIndex, count, shiftKey) {
  if (count <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= count) return shiftKey ? count - 1 : 0;
  if (shiftKey) return currentIndex === 0 ? count - 1 : currentIndex - 1;
  return currentIndex === count - 1 ? 0 : currentIndex + 1;
}
