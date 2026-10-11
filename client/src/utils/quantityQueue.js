/**
 * 数量キューの純粋関数ロジック
 * 部品 1 件分の状態: { confirmed, display, inFlight, dirty }
 */

export function createEntry(confirmed) {
  const c = Math.max(0, Math.floor(Number(confirmed) || 0));
  return {
    confirmed: c,
    display: c,
    inFlight: false,
    dirty: false
  };
}

export function applyStep(entry, delta) {
  return {
    ...entry,
    display: Math.max(0, entry.display + delta),
    dirty: true
  };
}

export function applySet(entry, value) {
  return {
    ...entry,
    display: Math.max(0, Math.floor(Number(value) || 0)),
    dirty: true
  };
}

/**
 * 送信を開始できるか判定
 * 開始可能なら { entry: inFlight=true/dirty=false, send: 送信する数値(またはnull) }、不可なら null
 */
export function beginFlush(entry) {
  if (entry.inFlight || !entry.dirty) return null;
  if (entry.display === entry.confirmed) {
    return { entry: { ...entry, dirty: false }, send: null };
  }
  return { entry: { ...entry, inFlight: true, dirty: false }, send: entry.display };
}

export function onSuccess(entry, serverValue) {
  const s = Math.max(0, Math.floor(Number(serverValue) || 0));
  return {
    ...entry,
    inFlight: false,
    confirmed: s
  };
}

export function onFailure(entry) {
  return {
    ...entry,
    inFlight: false,
    dirty: false,
    display: entry.confirmed
  };
}

export function isSettled(entry) {
  return !entry.inFlight && !entry.dirty && entry.display === entry.confirmed;
}
