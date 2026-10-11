// 写真ライトボックス（Issue #67）の表示判定とメタ情報
export function hasPreviewablePhoto(part) {
  return !!part && typeof part.image_path === 'string' && part.image_path.trim() !== '';
}

export function buildLightboxMeta(part, qty) {
  const p = part || {};
  const n = Number.isFinite(qty) ? qty : (Number.isFinite(p.quantity) ? p.quantity : 0);
  return {
    partNumber: p.part_number ? String(p.part_number) : '',
    name: p.name ? String(p.name) : '',
    category: p.category_name || '未分類',
    location: p.location_name || '場所未設定',
    qtyLabel: `在庫 ${n} 個`
  };
}
