import { ref } from 'vue';

// グローバルシングルトンのトーストキュー
const toasts = ref([]);
let nextId = 1;

/**
 * トーストを表示
 * @param {object|string} options 
 * @returns {number} toastId
 */
function show(options) {
  const opts = typeof options === 'string' ? { message: options } : options;
  const id = nextId++;
  const type = opts.type || 'info';
  const duration = opts.duration !== undefined ? opts.duration : (type === 'error' ? 4500 : 3000);

  const toastItem = {
    id,
    message: opts.message || '',
    type,
    duration,
    timer: null
  };

  if (duration > 0) {
    toastItem.timer = setTimeout(() => {
      dismiss(id);
    }, duration);
  }

  // 最大5件まで保持（古いものから削除）
  if (toasts.value.length >= 5) {
    const oldest = toasts.value.shift();
    if (oldest && oldest.timer) clearTimeout(oldest.timer);
  }

  toasts.value.push(toastItem);
  return id;
}

/**
 * 指定IDのトーストを消去
 * @param {number} id 
 */
function dismiss(id) {
  const index = toasts.value.findIndex(t => t.id === id);
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
  toasts.value.forEach(t => {
    if (t.timer) clearTimeout(t.timer);
  });
  toasts.value = [];
}

export function useToast() {
  return {
    toasts,
    show,
    dismiss,
    clearAll,
    success: (message, duration) => show({ message, type: 'success', duration }),
    error: (message, duration) => show({ message, type: 'error', duration }),
    warning: (message, duration) => show({ message, type: 'warning', duration }),
    info: (message, duration) => show({ message, type: 'info', duration })
  };
}
