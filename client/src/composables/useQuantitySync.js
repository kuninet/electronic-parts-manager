import { reactive } from 'vue';
import api from '../api';
import { useToast } from './useToast';
import * as Q from '../utils/quantityQueue';
import { getApiToken } from '../utils/apiToken.js';

const DEBOUNCE_MS = 400;
const entries = reactive(new Map()); // partId -> entry
const timers = new Map(); // partId -> timeoutId
const listeners = new Set(); // 確定値が変わったときの通知先

function ensure(part) {
  if (!entries.has(part.id)) {
    entries.set(part.id, Q.createEntry(Number(part.quantity) || 0));
  }
  return entries.get(part.id);
}

function schedule(id) {
  clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      flush(id);
    }, DEBOUNCE_MS)
  );
}

async function flush(id) {
  const cur = entries.get(id);
  if (!cur) return;
  const r = Q.beginFlush(cur);
  if (!r) return;
  entries.set(id, r.entry);
  if (r.send === null) {
    cleanup(id);
    return;
  }
  try {
    const res = await api.patch(`/parts/${id}`, { quantity: r.send });
    if (!entries.get(id)) return;
    const serverValue = Number(res.data?.quantity ?? r.send);
    entries.set(id, Q.onSuccess(entries.get(id), serverValue));
    listeners.forEach((fn) => fn(res.data));
    if (entries.get(id).dirty) {
      flush(id);
    } else {
      cleanup(id);
    }
  } catch (err) {
    if (!entries.get(id)) return;
    entries.set(id, Q.onFailure(entries.get(id)));
    useToast().error(
      err.response?.data?.error || '数量の更新に失敗しました。元の値に戻しました'
    );
    cleanup(id);
  }
}

function discard(id) {
  if (timers.has(id)) {
    clearTimeout(timers.get(id));
    timers.delete(id);
  }
  entries.delete(id);
}

function cleanup(id) {
  const e = entries.get(id);
  if (e && Q.isSettled(e) && !timers.has(id)) {
    entries.delete(id);
  }
}

function flushAll() {
  for (const id of Array.from(timers.keys())) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    flush(id);
  }
}

function hasPending() {
  for (const e of entries.values()) {
    if (!Q.isSettled(e)) return true;
  }
  return timers.size > 0;
}

function sendBeaconAll() {
  const apiBase = import.meta.env.VITE_API_BASE_URL || '/api';
  const token = getApiToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  for (const [id, e] of entries.entries()) {
    if (timers.has(id) || e.dirty) {
      try {
        fetch(`${apiBase}/parts/${id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ quantity: e.display }),
          keepalive: true
        });
      } catch {}
    }
  }
}

// ページ離脱・アプリ切り替え時の保護（モジュール読み込み時に1回だけ登録）
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushAll();
    }
  });

  window.addEventListener('pagehide', sendBeaconAll);

  window.addEventListener('beforeunload', (e) => {
    if (hasPending()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

export function useQuantitySync() {
  return {
    step(part, delta) {
      const e = ensure(part);
      entries.set(part.id, Q.applyStep(e, delta));
      schedule(part.id);
    },
    set(part, value) {
      const e = ensure(part);
      entries.set(part.id, Q.applySet(e, value));
      schedule(part.id);
    },
    displayOf(part) {
      const e = entries.get(part.id);
      return e ? e.display : (Number(part.quantity) || 0);
    },
    overlay(list) {
      return list.map((p) => {
        const e = entries.get(p.id);
        return e ? { ...p, quantity: e.display } : p;
      });
    },
    flushAll,
    hasPending,
    discard,
    onConfirmed(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
}
