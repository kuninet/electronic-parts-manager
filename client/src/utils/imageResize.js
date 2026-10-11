/**
 * クライアント側での画像ファイルリサイズユーティリティ
 */

const DEFAULT_OPTIONS = {
  maxWidth: 1200,
  maxHeight: 1200,
  quality: 0.8,
  skipThresholdBytes: 500 * 1024, // 500KB
  mimeType: 'image/jpeg'
};

/**
 * 画像ファイルを長辺最大1200px、JPEG品質80%にリサイズ・圧縮する
 * 
 * @param {File} file アップロード対象のFileオブジェクト
 * @param {object} [options] オプション
 * @param {number} [options.maxWidth=1200] 最大幅
 * @param {number} [options.maxHeight=1200] 最大高さ
 * @param {number} [options.quality=0.8] JPEG品質 (0.0〜1.0)
 * @param {number} [options.skipThresholdBytes=524288] スキップするファイルサイズ閾値 (バイト)
 * @param {function} [options.onProgress] 進行状況コールバック (status: 'start' | 'loading' | 'resizing' | 'done' | 'skipped')
 * @returns {Promise<File>} リサイズ後のFile（または元のFile）
 */
export async function resizeImageFile(file, options = {}) {
  const opt = { ...DEFAULT_OPTIONS, ...options };

  // ファイルが未指定、または画像でない場合はそのまま返す
  if (!file || !(file instanceof Blob || (typeof File !== 'undefined' && file instanceof File))) {
    return file;
  }

  // 画像タイプチェック
  if (!file.type || !file.type.startsWith('image/')) {
    if (opt.onProgress) opt.onProgress('skipped');
    return file;
  }

  // GIFアニメーションやSVGはリサイズ対象外とする
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
    if (opt.onProgress) opt.onProgress('skipped');
    return file;
  }

  // 閾値以下（デフォルト500KB以下）の場合はリサイズをスキップ
  if (file.size <= opt.skipThresholdBytes) {
    if (opt.onProgress) opt.onProgress('skipped');
    return file;
  }

  if (opt.onProgress) opt.onProgress('start');

  let imageBitmap = null;
  let objectUrl = null;

  try {
    let sourceWidth = 0;
    let sourceHeight = 0;
    let drawSource = null;

    if (opt.onProgress) opt.onProgress('loading');

    // EXIFの自動回転補正（createImageBitmap の imageOrientation オプション）を試行
    if (typeof createImageBitmap === 'function') {
      try {
        imageBitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        sourceWidth = imageBitmap.width;
        sourceHeight = imageBitmap.height;
        drawSource = imageBitmap;
      } catch (bitmapErr) {
        // フォールバック: 通常のcreateImageBitmapまたはHTMLImageElement
        try {
          imageBitmap = await createImageBitmap(file);
          sourceWidth = imageBitmap.width;
          sourceHeight = imageBitmap.height;
          drawSource = imageBitmap;
        } catch (e) {
          // 下記のImage要素フォールバックへ
        }
      }
    }

    if (!drawSource) {
      // HTMLImageElement によるフォールバック
      objectUrl = URL.createObjectURL(file);
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
        img.src = objectUrl;
      });
      sourceWidth = img.naturalWidth || img.width;
      sourceHeight = img.naturalHeight || img.height;
      drawSource = img;
    }

    if (opt.onProgress) opt.onProgress('resizing');

    // 縮小率計算（長辺をmaxWidth/maxHeightに収める）
    const scale = Math.min(opt.maxWidth / sourceWidth, opt.maxHeight / sourceHeight, 1);
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');

    // JPEG変換時の透過背景透過防止（白背景）
    if (opt.mimeType === 'image/jpeg') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetWidth, targetHeight);
    }

    ctx.drawImage(drawSource, 0, 0, targetWidth, targetHeight);

    // CanvasからBlobを取得
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('CanvasからBlobへの変換に失敗しました'));
        },
        opt.mimeType,
        opt.quality
      );
    });

    // リサイズ後の方がサイズが大きくなってしまった場合は元ファイルを優先
    if (blob.size >= file.size) {
      if (opt.onProgress) opt.onProgress('done');
      return file;
    }

    // 拡張子とファイル名の調整
    let newFileName = file.name || 'image.jpg';
    if (opt.mimeType === 'image/jpeg' && !/\.(jpe?g)$/i.test(newFileName)) {
      newFileName = newFileName.replace(/\.[^.]+$/, '') + '.jpg';
    }

    const resizedFile = new File([blob], newFileName, {
      type: opt.mimeType,
      lastModified: Date.now()
    });

    if (opt.onProgress) opt.onProgress('done');
    return resizedFile;
  } catch (err) {
    console.warn('[imageResize] クライアントリサイズに失敗したため、元ファイルを使用します:', err);
    if (opt.onProgress) opt.onProgress('skipped');
    return file;
  } finally {
    if (imageBitmap && typeof imageBitmap.close === 'function') {
      imageBitmap.close();
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
}
