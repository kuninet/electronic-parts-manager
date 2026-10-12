/**
 * ホバー拡大ポップアップの表示位置を計算する純粋関数
 *
 * @param {object} p
 * @param {{left:number, top:number, right:number, bottom:number, width:number, height:number}} p.rect 写真の getBoundingClientRect()
 * @param {{width:number, height:number}} p.viewport window.innerWidth / innerHeight
 * @param {{width:number, height:number}} p.size 希望の大きさ（D3）
 * @param {number} [p.margin=16] 画面の端との余白
 * @param {number} [p.gap=12] 写真とポップアップの間隔
 * @returns {{left:number, top:number, width:number, height:number, side:'left'|'right'}}
 */
export function computeHoverPreviewPosition({ rect, viewport, size, margin = 16, gap = 12 }) {
  // 1. 大きさをビューポートに収める
  const maxAvailableWidth = Math.max(0, viewport.width - margin * 2);
  const maxAvailableHeight = Math.max(0, viewport.height - margin * 2);
  const width = Math.min(size.width, maxAvailableWidth);
  const height = Math.min(size.height, maxAvailableHeight);

  // 2. 左側を優先判定: rect.left - gap - width >= margin なら写真の左に出す
  let side = 'left';
  let left;

  if (rect.left - gap - width >= margin) {
    side = 'left';
    left = rect.left - gap - width;
  } else {
    // 3. 左に入らなければ写真の右に出す
    side = 'right';
    const desiredRightLeft = rect.right + gap;
    const maxLeft = viewport.width - margin - width;
    if (desiredRightLeft <= maxLeft) {
      left = desiredRightLeft;
    } else {
      // 右にも入らなければ、右端に寄せる
      left = maxLeft;
    }
    // 画面左端を下回らないよう保護
    if (left < margin) {
      left = margin;
    }
  }

  // 4. 縦位置は写真の中心に合わせ、マージン内に収める
  const photoCenterY = rect.top + rect.height / 2;
  let top = photoCenterY - height / 2;

  const minTop = margin;
  const maxTop = Math.max(margin, viewport.height - margin - height);
  if (top < minTop) {
    top = minTop;
  } else if (top > maxTop) {
    top = maxTop;
  }

  return {
    left,
    top,
    width,
    height,
    side
  };
}
