import { ref } from 'vue';

// グローバルシングルトンのトーストキュー
const toasts = ref([]);
let nextId = 1;

const DEFAULT_DURATIONS = {
  success: 2500,
  info: 3000,
  warning: 4000,
  error: 5000
};

/**
 * トーストを表示
 * @param {object|string} options
 * @returns {number} toastId
 */
function show(options) {
  const opts = typeof options === 'string' ? { message: options } : options;
  const id = nextId++;
  const type = opts.type || 'info';
  const duration =
    opts.duration !== undefined
      ? opts.duration
      : DEFAULT_DURATIONS[type] || 3000;

  const toastItem = {
    id,
    message: opts.message || '',
    type,
    duration,
    remainingTime: duration,
    startTime: Date.now(),
    timer: null
  };

  if (duration > 0) {
    toastItem.timer = setTimeout(() => {
      dismiss(id);
    }, duration);
  }

  // 最大3件まで保持（超過時は古いものから削除）
  if (toasts.value.length >= 3) {
    const oldest = toasts.value.shift();
    if (oldest && oldest.timer) clearTimeout(oldest.timer);
  }

  toasts.value.push(toastItem);
  return id;
}

/**
 * 一時停止（ホバー・フォーカス時）
 * @param {number} id
 */
function pause(id) {
  const item = toasts.value.find((t) => t.id === id);
  if (item && item.timer) {
    clearTimeout(item.timer);
    item.timer = null;
    const elapsed = Date.now() - item.startTime;
    item.remainingTime = Math.max(0, item.remainingTime - elapsed);
  }
}

/**
 * 再開（ホバー解除・フォーカスアウト時）
 * @param {number} id
 */
function resume(id) {
  const item = toasts.value.find((t) => t.id === id);
  if (item && !item.timer && item.remainingTime > 0) {
    item.startTime = Date.now();
    item.timer = setTimeout(() => {
      dismiss(id);
    }, item.remainingTime);
  }
}

/**
 * 指定IDのトーストを消去
 * @param {number} id
 */
function dismiss(id) {
  const index = toasts.value.findIndex((t) => t.id === id);
  if (index !== -1) {
    const item = toasts.value[index];
    if (item.timer) clearTimeout(item.timer);
    toasts.value.splice(index, 1);
  }
}

/**
 * 全トーストを消去
 */
function clearAll() {
  toasts.value.forEach((t) => {
    if (t.timer) clearTimeout(t.timer);
  });
  toasts.value = [];
}

export function useToast() {
  return {
    toasts,
    show,
    dismiss,
    pause,
    resume,
    clearAll,
    success: (message, duration) =>
      show({ message, type: 'success', duration }),
    error: (message, duration) =>
      show({ message, type: 'error', duration }),
    warning: (message, duration) =>
      show({ message, type: 'warning', duration }),
    info: (message, duration) =>
      show({ message, type: 'info', duration })
  };
}
