const PART_NUMBER_MAX_LENGTH = 100;

/**
 * 型番の正規化とバリデーションを行う
 * D1規則:
 * - 前後空白は trim
 * - 改行とタブは空白 1 つに置換
 * - '', 'null', null は NULL (value: null)
 * - undefined は未送信として区別 (value: undefined)
 * - 最大 100 文字で、超えたらエラー
 * 
 * @param {any} val
 * @returns {{ value?: string|null, error?: string }}
 */
function normalizePartNumber(val) {
  if (val === undefined) {
    return { value: undefined };
  }
  if (val === null) {
    return { value: null };
  }

  let str = String(val);
  str = str.replace(/[\r\n\t]+/g, ' ').trim();

  if (str === '' || str.toLowerCase() === 'null') {
    return { value: null };
  }

  if (str.length > PART_NUMBER_MAX_LENGTH) {
    return { error: `型番は${PART_NUMBER_MAX_LENGTH}文字以内で入力してください` };
  }

  return { value: str };
}

module.exports = {
  normalizePartNumber,
  PART_NUMBER_MAX_LENGTH
};
