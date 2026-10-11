/**
 * 検索クエリに基づいてテキストを分割し、ハイライト用セグメント配列を返す
 * XSS対策のため、v-html ではなく Vue テンプレートの mark 要素で描画する
 * 
 * @param {string|null|undefined} text 対象テキスト
 * @param {string|null|undefined} query 検索クエリ
 * @returns {Array<{ text: string, match: boolean }>}
 */
export function splitByQuery(text, query) {
  if (text === null || text === undefined || text === '') {
    return [];
  }
  const str = String(text);
  if (!query || typeof query !== 'string' || !query.trim()) {
    return [{ text: str, match: false }];
  }

  const trimmedQuery = query.trim();
  const escaped = trimmedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');

  const parts = str.split(regex);
  const result = [];

  for (const part of parts) {
    if (!part) continue;
    const isMatch = part.toLowerCase() === trimmedQuery.toLowerCase();
    result.push({
      text: part,
      match: isMatch
    });
  }

  return result;
}
