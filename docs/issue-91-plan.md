# Issue #91 計画書: 部品写真を返す MCP ツール `get_part_image`

- 作業ブランチ: `feat/issue-91-mcp-get-part-image`
- 目的: マルチモーダル AI（Antigravity、Claude Desktop、Cursor など）が部品写真を MCP の `image` コンテンツとして直接受け取り、刻印や形状を読み取って、部品名や型番を補正できるようにする
- 対象:
  - `mcp/`: `image.js`（新規・純関数）、`apiClient.js`（`getImage`）、`config.js`（`imageMaxBytes`）、`tools/getPartImage.js`（新規）、`server.js`、テスト
  - `docs/MCP.md`
- サーバー（`server/`）とクライアント（`client/`）は変更しない

---

## 0. 調査結果（現状）

### 0-1. 画像の保存と配信

| 項目 | 実態 | 根拠 |
|---|---|---|
| `image_path` の形 | 常に `/uploads/<timestamp>-<rand>.<ext>`（ローカル保存でも S3 保存でも同じ） | `server/routes/parts.js:262-277` |
| 受け付ける形式 | JPG / PNG / GIF / WEBP のみ（MIME と拡張子の両方を検査） | `parts.js:252-257` |
| 保存時の加工 | `resizeImageBuffer`: 長辺 1200px。JPEG は品質 80（mozjpeg）、WEBP は品質 80 で再圧縮する。**PNG / GIF は縮小だけで再圧縮しない** | `server/utils/image.js:3-32` |
| 典型的なサイズ | 手元の JPEG は 200〜300KB 程度（`uploads/` の実測） | ― |
| LAN での配信 | `express.static('/uploads')`（`maxAge 1y`）。拡張子から `Content-Type` が付く。**API トークン認証（#86）の対象外**（`/api` だけにかかる） | `server/index.js:61-66`, `server/middleware/apiTokenAuth.js` |
| LAN の :5173 | vite preview が `/uploads` も :3001 へプロキシする | `client/vite.config.js:134-137` |
| AWS での配信 | CloudFront の `/uploads/*` ビヘイビアから S3（OAC）。`Authorization` は S3 へ転送しない（`Headers: 0`）。**Basic 認証の CloudFront Function は `/uploads/*` にも付く** | `scripts/aws/deploy-frontend.sh:200-216`, `deploy-basic-auth.sh:109-111` |
| AWS で画像が無い場合 | S3 は存在しないキーに 403 を返し、CloudFront の `CustomErrorResponses` が **403 / 404 を `index.html`（200、`text/html`）に差し替える**。「画像が無い」が「200 の HTML」として返ってくる | `deploy-frontend.sh:218-236` |
| S3 の `Content-Type` | アップロード時の `file.mimetype` | `parts.js:266-271` |

### 0-2. MCP の現状（#84 / #86 / #89 の実装）

- `mcp/apiClient.js` の `request()` は JSON 専用。2xx でも JSON として読めなければ `invalid_response` になる。
  - `Accept: application/json`、`User-Agent`、`Authorization`（設定時）を付ける。
  - エラーは `kind`（`network` / `timeout` / `unauthorized` / `forbidden` / `not_found` / `bad_request` / `conflict` / `http` / `invalid_response`）で分類する。
  - 401 の文言は `authType` で切り替える。
- `mcp/format.js` の `formatImageUrl(imagePath, apiUrl)` は、`http(s)://` の値をそのまま返す。
  - **他のオリジンへの URL も通してしまう**（表示用なので問題はなかった）。
- `mcp/server.js` は、参照系（常に登録）と書き込み系（`!readOnly` のときだけ登録）の 2 群に分けて登録している。
- ツール数を固定値で検査しているテストが 6 か所ある（**このままでは壊れる**）:
  - `mcp/test/tools.test.js:31`（6）
  - `mcp/test/writeTools.test.js:32`（6）、`:54`（3）
  - `mcp/test/stdio.test.js:99`（6、名前の配列も）、`:164`（6）、`:340`（3）
- SDK（1.32.1）の `ImageContentSchema` は `{ type: 'image', data: <base64>, mimeType: string }`。
- `docs/MCP.md:332` には「AI クライアントが画像を直接取得できない場合は〜」という注記がある。今回のツールで解消するので書き換える。

### 0-3. クライアント側の大きさの上限

- 公式の明記は見つからなかった。ただし、Claude Desktop には**ツール結果 1MiB（1,048,576 バイト）の上限**があるとする報告が、複数の MCP サーバーの README にある。
  - 例: `result exceeds maximum length of 1048576` というエラー。1MB を超える画像は、ファイルに保存してパスを返す方式に切り替える実装もある。
- Base64 は元のバイト数の約 4/3 倍になる。元画像が **約 750KB を超えると** 1MiB の上限に届く。
- 本アプリの JPEG（長辺 1200px、品質 80）は通常この範囲に収まる。再圧縮しない PNG / GIF は超えることがある。
- 要件の 10MB は、MCP プロセスのメモリを守るための上限としては妥当。ただし「クライアントが受け取れる大きさ」とは別物として扱う必要がある（D5）。

---

## 1. 設計判断

### D1. 純関数モジュール `mcp/image.js`（新規）

テストしやすくするため、判断ロジックを純関数にまとめる。

```js
resolveImageRequestUrl(imagePath, apiUrl) // -> { url: URL } | { error: 'empty' | 'invalid' | 'foreign_origin' | 'outside_uploads' }
sniffImageMime(buffer)                    // -> 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | null
resolveImageMime({ buffer, contentType, imagePath }) // -> { mimeType } | { error: 'unsupported' }
formatBytes(n)                            // -> '312 KB' / '10.5 MB'
```

**`resolveImageRequestUrl`（取得先の安全確認）**

- `imagePath` が空なら `empty`。
- `new URL(imagePath, apiUrl + '/')` で解決する。例外が出たら `invalid`。
- 解決した URL の `origin` が `new URL(apiUrl).origin` と違えば **`foreign_origin`**。`Authorization`（Basic やトークン）を他のホストへ送らないため。
- 解決後の `pathname` が `/uploads/` で始まらなければ **`outside_uploads`**。
  - WHATWG URL は `..` や `%2e%2e` を正規化する。そのため、`/uploads/../api/backup/export/full` は `/api/backup/...` に解決され、ここで弾かれる。
  - 認証付きで API の任意のパスを取得されることを防ぐ。
- 現状の `image_path` は常に `/uploads/...` なので、正常系には影響しない。

**`sniffImageMime`（先頭バイトによる判定）**

| 形式 | 先頭バイト |
|---|---|
| JPEG | `FF D8 FF` |
| PNG | `89 50 4E 47 0D 0A 1A 0A` |
| GIF | `47 49 46 38`（`GIF8`） |
| WEBP | `52 49 46 46`（`RIFF`）で始まり、8〜11 バイト目が `57 45 42 50`（`WEBP`） |

**`resolveImageMime`（MIME の決定順）**

1. `sniffImageMime(buffer)` が判定できれば、それを使う（**最優先**）。S3 の `Content-Type` が誤っていても、実体に合わせられる。
2. `contentType`（`;` より前を小文字にしたもの）が上の 4 種のどれかなら、それを使う。
3. `imagePath` の拡張子: `.jpg` / `.jpeg` → `image/jpeg`、`.png`、`.gif`、`.webp`。
4. ここまでで決まらず、`contentType` が `image/` で始まる 4 種以外（`image/svg+xml`、`image/heic` など）なら `unsupported`。
5. それ以外は要件どおり **`image/jpeg`**（既定値）。

- `text/html` などの画像でない応答は、この関数に来る前に `getImage` で弾く（D2）。

### D2. `apiClient.getImage(imagePath)`（`mcp/apiClient.js`）

- JSON 用の `request()` とは別に、内部関数 `requestBinary(url)` を作る。エラーを `ApiError` に変換する部分（401 / 403 / 404 / その他）は `request()` と共通化する（`toHttpError(status, bodyText)` に切り出す）。
- 手順:
  1. `resolveImageRequestUrl(imagePath, config.apiUrl)` を呼ぶ。エラーなら `ApiError('bad_request', null, '画像パスが不正です（...）')` を投げ、**fetch は呼ばない**。
  2. `fetchImpl(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs) })`。
     - `headers` は `Accept: image/*`、`User-Agent`、`Authorization`（設定時）。
     - `redirect: 'error'` にして、リダイレクトの先へ認証情報が渡らないようにする（`/uploads` の正常な配信でリダイレクトは起きない）。
  3. `!response.ok` なら、共通のエラー変換を使う。404 は `not_found`（文言は `画像ファイルが見つかりません`）。
  4. **`Content-Type` が `text/` で始まるか、`application/json` なら `invalid_response`**。文言は `画像ではなく <type> が返りました。画像ファイルが削除されている可能性があります。`。
     - AWS で画像が無いと、CloudFront が `index.html` を 200 で返す（§0-1）。
  5. **サイズの上限（`config.imageMaxBytes`）**:
     - `Content-Length` が上限を超えていれば、本文を読まずに `response.body.cancel()` して `ApiError('too_large', null, ...)` を投げる。
     - `Content-Length` が無い場合（chunked）や偽っている場合に備えて、`response.body.getReader()` で読みながら累計を数える。上限を超えた時点で `reader.cancel()` して `too_large` を投げる。
     - 上限内なら、`Buffer.concat(chunks)` を返す。
  6. 長さが 0 なら `invalid_response`（`画像データが空です`）。
  7. 返却は `{ buffer, contentType: response.headers.get('content-type'), size: buffer.length }`。
- `kind` に **`too_large`** を足す（JSDoc の列挙も更新する）。文言は `画像が大きすぎます（<size> / 上限 <limit>）。EPM_IMAGE_MAX_BYTES で上限を変更できます。`（Content-Length で判定したときはその値、読み取り中なら「上限超過」と書く）。
- タイムアウト: 既存の `timeoutMs`（既定 10 秒）をそのまま使う。`AbortSignal.timeout` は本文の読み取り中にも効く。GET なので `unknownOutcome` は付けない。
- 401 の文言は既存どおり `authType` で切り替える。LAN の `/uploads` はトークン認証の対象外なので、401 が起きるのは実際には AWS の Basic 認証だけになる。
- 公開メソッドに `getImage: (imagePath) => getImage(imagePath)` を足す。

### D3. 設定 `EPM_IMAGE_MAX_BYTES`（`mcp/config.js`）

- 既定は `10485760`（10MB、要件どおり）。正の整数でなければ起動時にエラー（既存の `EPM_API_TIMEOUT_MS` と同じ作法）。
- 上限は `52428800`（50MB）とし、超える値はエラーにする。メモリを守るため。
- `loadConfig` の返却に `imageMaxBytes` を足す。

### D4. ツール `get_part_image`（`mcp/tools/getPartImage.js`）

- 登録:
  - タイトルは `部品写真取得`。
  - 説明: 「部品 ID を指定して、登録されている部品写真を画像として返します。刻印・型番・形状の確認に使えます。画像の無い部品はテキストで通知します。」
  - `annotations` は `{ readOnlyHint: true, idempotentHint: true, openWorldHint: false }`。
  - `inputSchema` は `{ id: z.number().int().positive() }`。
- 処理:
  1. `apiClient.getPart(id)` を呼ぶ。
     - `ApiError` の `not_found` なら、`toolError('部品 ID <id> は見つかりません。')` を返す（要件どおりの文言）。
     - それ以外のエラーは `toolError(err.message)`。
  2. `part.image_path` が `null` / `undefined` / 空文字（trim 後）なら、`{ content: [{ type: 'text', text: '部品 ID <id> (<name>) には画像が登録されていません。' }] }` を返す。`isError` は付けない。
  3. `apiClient.getImage(part.image_path)` を呼ぶ。失敗したら `toolError('部品 ID <id> (<name>) の画像を取得できませんでした: <err.message>')`。
     - 画像の取得失敗は `isError: true` とする。DB に登録があるのに取れないのは異常であり、AI に「画像は無い」と誤解させないため（💡-2）。
  4. `resolveImageMime({ buffer, contentType, imagePath })` を呼ぶ。`unsupported` なら `toolError('… の画像形式（<contentType>）には対応していません。')`。
  5. 返却:
     ```js
     {
       content: [
         { type: 'image', data: buffer.toString('base64'), mimeType },
         { type: 'text', text: `部品 ID ${id} (${name}) の登録写真です。` + sizeNote },
       ],
     }
     ```
     - `sizeNote` は、`size > SOFT_LIMIT_BYTES`（`750 * 1024`。`image.js` の定数）のときだけ付ける。文言は ` （画像サイズ ${formatBytes(size)}。クライアントによっては大きすぎて表示できない場合があります）`。それ以外は空文字で、要件どおりの文言になる（D5）。
- ゴミ箱や使用済みの部品も、`getPart` が返す限り画像を返す（`get_part_detail` と同じ扱い）。
- 画像のデータ（Base64）はログに出さない。stderr にも出さない。

### D5. 大きさの二段構え

- **ハードな上限（`EPM_IMAGE_MAX_BYTES`、既定 10MB）**: MCP プロセスのメモリを守る。超えたら取得を中断し、`isError` にする。
- **ソフトな目安（750KB、固定）**: Claude Desktop などの 1MiB の上限（Base64 で約 4/3 倍）を考えた目安。超えても画像は返し、テキストに注意を添える。
  - クライアントで表示できなかったときに、AI とユーザーが原因に気づけるようにするため。
- MCP 側での縮小（sharp などのネイティブ依存）は入れない。ルートの依存にネイティブモジュールを足すと、MCP を動かすマシン（Mac など）のインストールが重くなるため。
  - 必要になったら、サーバーに縮小版を返す API を足す案を別 Issue にする（💡-1）。

### D6. 登録（`mcp/server.js`）

- 参照系の群（`if (!readOnly)` の外）で、`registerListMasterDataTool` の直後に `registerGetPartImageTool(server, { apiClient, apiUrl })` を呼ぶ。
- ツールの数: 通常は 7、`EPM_MCP_READONLY` のときは 4。既存テストの 6 か所の固定値と名前の配列を更新する（§0-2）。

### D7. ドキュメント（`docs/MCP.md`）

- 冒頭のツール一覧に `get_part_image` を足し、参照系であること（読み取り専用モードでも有効）を書く。
- §2 に `get_part_image` の節を新設する:
  - 引数。
  - 返却例（`image` と `text` の 2 要素。`data` は省略表記）。
  - 画像が無い場合の例。
  - エラーの例（部品が無い、画像が取得できない、大きすぎる、非対応の形式）。
  - 対応形式（JPEG / PNG / GIF / WEBP）と MIME の判定順。
- §3 の環境変数の表に `EPM_IMAGE_MAX_BYTES` を足す。
- 大きさの注意: クライアントの上限（Claude Desktop は 1MiB 前後との報告がある）と、750KB の目安。
- §5 の AWS の注記（:332）を書き換える: 「`get_part_image` は `EPM_BASIC_AUTH` を付けて画像を取得するため、AWS の Basic 認証の下でも画像を AI に渡せる。`image_url` を AI が直接開く場合は、引き続き認証が必要」。
- トラブルシューティングに次の 2 行を足す:
  - 「画像ではなく text/html が返りました」→ 画像ファイルが削除されている（AWS では CloudFront が index.html を返す）。
  - 「画像が大きすぎます」→ `EPM_IMAGE_MAX_BYTES` の調整、または写真の撮り直し。

### D8. スコープ外

- 保管場所の画像（`locations.image_path`）の返却。需要があれば、同じ `image.js` と `getImage` を使う `get_location_image` で足す（💡-3）。
- サーバー側での縮小版の生成、複数枚の画像、データシート（PDF）の返却。
- MCP の Resources（`resources/read`）での画像提供。

---

## 2. 実装ステップ

| Step | 内容 | 確認 |
|---|---|---|
| 1 | `mcp/image.js` と `mcp/test/image.test.js`（I-1〜I-16） | `npm run test:mcp` |
| 2 | `mcp/config.js` の `imageMaxBytes` と、`config.test.js` への追記（C-13〜C-15） | `npm run test:mcp` |
| 3 | `mcp/apiClient.js` の `getImage` / `requestBinary` / `too_large` / エラー変換の共通化と、`apiClient.test.js` への追記（A-21〜A-33） | `npm run test:mcp`（既存の A-1〜A-20 も通ること） |
| 4 | `mcp/tools/getPartImage.js`、`server.js` への登録、`mcp/test/getPartImage.test.js`（GI-1〜GI-16）。既存のツール数の検査 6 か所を更新する | `npm run test:mcp` |
| 5 | `mcp/test/stdio.test.js` に S-9〜S-12 を追加する。モック HTTP サーバーに `/api/parts/2`（画像あり）、`/api/parts/3`（画像なし）、`/uploads/test.png`（実際の PNG のバイト列）を足す | `npm run test:mcp` |
| 6 | `wiring.test.js` に W-10〜W-12 を追加し、`docs/MCP.md` を更新する（D7） | `npm test`（ルート全体） |
| 7 | 実機での受入（U-1〜U-9） | §3-6 |

- 実装担当は全ステップ Sonnet でよい（判断は本書で決めきっている）。
  - Step 3 の、本文を読みながらサイズの上限で打ち切る処理だけは、レビューで重点的に見る。
- レビューは Opus。重点は次のとおり:
  - 他オリジンや `/uploads` の外へ認証付きで取りに行かないこと。
  - `redirect: 'error'`。
  - 上限を超えたら読み取りを中断していること（Content-Length を信用しきらないこと）。
  - text/html を画像として返さないこと。
  - Base64 をログに出していないこと。

---

## 3. 受入テスト（Given-When-Then）

### 3-1. `image.js`（I）

| ID | Given | When | Then |
|---|---|---|---|
| I-1 | apiUrl が `http://localhost:3001` | `resolveImageRequestUrl('/uploads/a.jpg', apiUrl)` | `url.href === 'http://localhost:3001/uploads/a.jpg'` |
| I-2 | apiUrl が `https://x.cloudfront.net` | `'uploads/a.jpg'`（先頭の `/` なし） | `https://x.cloudfront.net/uploads/a.jpg` |
| I-3 | 同上 | `'https://x.cloudfront.net/uploads/a.jpg'`（同じオリジンの絶対 URL） | 受け付ける |
| I-4 | 同上 | `'https://evil.example/uploads/a.jpg'` | `{ error: 'foreign_origin' }` |
| I-5 | 同上 | `'/uploads/../api/backup/export/full'`、`'/uploads/%2e%2e/api/parts'` | `{ error: 'outside_uploads' }` |
| I-6 | 同上 | `'/api/parts/1'` | `{ error: 'outside_uploads' }` |
| I-7 | ― | `null`、`''`、`'   '` | `{ error: 'empty' }` |
| I-8 | JPEG の先頭バイト | `sniffImageMime` | `'image/jpeg'` |
| I-9 | PNG / GIF89a / GIF87a の先頭バイト | 同上 | `'image/png'` / `'image/gif'` / `'image/gif'` |
| I-10 | `RIFF....WEBP` | 同上 | `'image/webp'` |
| I-11 | `RIFF....WAVE`、`<!doctype html>`、長さ 2 のバッファ | 同上 | `null` |
| I-12 | PNG のバイト列で `contentType: 'image/jpeg'`、パスは `.jpg` | `resolveImageMime` | `'image/png'`（先頭バイトが優先） |
| I-13 | 判定できないバイト列で `contentType: 'image/webp; charset=binary'` | 同上 | `'image/webp'` |
| I-14 | 判定できないバイト列で `contentType: 'application/octet-stream'`、パスは `.gif` | 同上 | `'image/gif'` |
| I-15 | 判定できないバイト列で `contentType: 'image/svg+xml'` | 同上 | `{ error: 'unsupported' }` |
| I-16 | 判定できないバイト列で `contentType: null`、パスに拡張子なし | 同上 | `'image/jpeg'`（既定値）。あわせて `formatBytes(1536) === '1.5 KB'`、`formatBytes(10485760) === '10.0 MB'` |

### 3-2. config（C の追加分）

| ID | Given | When | Then |
|---|---|---|---|
| C-13 | `EPM_IMAGE_MAX_BYTES` が未設定 | `loadConfig` | `imageMaxBytes === 10485760` |
| C-14 | `EPM_IMAGE_MAX_BYTES=2000000` | 同上 | `2000000` |
| C-15 | `0`、`-1`、`abc`、`1.5`、`52428801` | 同上 | 例外を投げる。メッセージに `EPM_IMAGE_MAX_BYTES` を含む |

### 3-3. `apiClient.getImage`（A の追加分）: モック HTTP サーバー

| ID | Given | When | Then |
|---|---|---|---|
| A-21 | `/uploads/a.png` が PNG のバイト列（`image/png`）を返す | `getImage('/uploads/a.png')` | `buffer` が送ったバイト列と一致する。`contentType === 'image/png'`、`size` が一致する |
| A-22 | `authHeader = 'Basic xxx'` | 同上 | モックが受信した `authorization === 'Basic xxx'`、`accept` が `image/*` |
| A-23 | `authHeader = null` | 同上 | `authorization` ヘッダーが無い |
| A-24 | モックが 404 | 同上 | `kind === 'not_found'` |
| A-25 | モックが 401 で `authType: 'basic'` | 同上 | `kind === 'unauthorized'`。文言に `EPM_BASIC_AUTH` を含む |
| A-26 | モックが 200 で `text/html` の `<!doctype html>`（CloudFront の差し替えを再現） | 同上 | `kind === 'invalid_response'`。文言に `text/html` を含む |
| A-27 | `imageMaxBytes: 1000` で、`Content-Length: 5000` を宣言する | 同上 | `kind === 'too_large'`。モックが本文を書き終える前に解決する |
| A-28 | `imageMaxBytes: 1000` で、`Content-Length` なし（chunked）に 600 バイトを 3 回送る | 同上 | `kind === 'too_large'`（読み取り中に打ち切る） |
| A-29 | `imageMaxBytes: 1000` で、ちょうど 1000 バイト | 同上 | 成功する（境界値） |
| A-30 | モックが応答しない。`timeoutMs: 100` | 同上 | `kind === 'timeout'`、`unknownOutcome` は偽 |
| A-31 | モックが 302 で `Location: http://other/` | 同上 | 失敗する（`network` か `http`）。リダイレクト先へ要求が出ていない |
| A-32 | `fetchImpl` を記録用の偽物にする | `getImage('https://evil.example/uploads/a.jpg')`、`getImage('/api/parts/1')` | `kind === 'bad_request'`。**`fetchImpl` が 1 回も呼ばれない** |
| A-33 | モックが 200 で長さ 0 | 同上 | `kind === 'invalid_response'` |

### 3-4. ツール（GI）: InMemoryTransport + 偽の apiClient

| ID | Given | When | Then |
|---|---|---|---|
| GI-1 | `readOnly: false` | `listTools` | 7 ツール。`get_part_image` の `annotations` は `readOnlyHint: true, idempotentHint: true, openWorldHint: false`。`inputSchema.required` が `['id']` |
| GI-2 | `readOnly: true` | `listTools` | 4 ツールで、`get_part_image` を含む |
| GI-3 | `getPart(1)` が `{ id:1, name:'NE555', image_path:'/uploads/a.jpg' }`、`getImage` が JPEG のバイト列（`image/jpeg`） | `get_part_image { id: 1 }` | `content[0]` が `{ type:'image', mimeType:'image/jpeg' }` で、`data` を Base64 デコードすると元のバイト列に一致する。`content[1].text === '部品 ID 1 (NE555) の登録写真です。'`。`isError` は無い |
| GI-4 | `getImage` の引数を記録する | 同上 | `getImage` が `'/uploads/a.jpg'` で 1 回だけ呼ばれる |
| GI-5 | `image_path: null` | 同上 | `content` がテキスト 1 件だけで、`'部品 ID 1 (NE555) には画像が登録されていません。'`。`isError` は無い。`getImage` は呼ばれない |
| GI-6 | `image_path` が `''`、`'  '`、キー自体が無い | 同上 | GI-5 と同じ |
| GI-7 | `getPart` が `ApiError(not_found)` を投げる | `get_part_image { id: 999 }` | `isError: true`。本文が `'部品 ID 999 は見つかりません。'` |
| GI-8 | `getPart` が `ApiError(network)` を投げる | 同上 | `isError: true`。本文に `EPM_API_URL` を含む |
| GI-9 | `getImage` が `ApiError(not_found, '画像ファイルが見つかりません')` を投げる | `get_part_image { id: 1 }` | `isError: true`。本文に `部品 ID 1 (NE555) の画像を取得できませんでした` と `画像ファイルが見つかりません` を含む |
| GI-10 | `getImage` が `ApiError(too_large, …)` を投げる | 同上 | `isError: true`。本文に `大きすぎます` と `EPM_IMAGE_MAX_BYTES` を含む |
| GI-11 | `getImage` が `ApiError(invalid_response, …text/html…)` を投げる | 同上 | `isError: true`。本文に `text/html` を含む |
| GI-12 | `getImage` が PNG のバイト列を `contentType: 'image/jpeg'` で返す | 同上 | `mimeType === 'image/png'` |
| GI-13 | `getImage` が判定できないバイト列を `image/svg+xml` で返す | 同上 | `isError: true`。本文に「対応していません」を含む |
| GI-14 | `getImage` が `size = 800 * 1024` のバイト列を返す | 同上 | 画像は返る。テキストが `'部品 ID 1 (NE555) の登録写真です。'` で始まり、`800 KB` と「表示できない場合」を含む |
| GI-15 | ― | `{}`、`{ id: 0 }`、`{ id: 1.5 }`、`{ id: '1' }` | `isError: true`（スキーマ検証）。`getPart` は呼ばれない |
| GI-16 | ゴミ箱の部品（`deleted_at` あり）に画像がある | `get_part_image` | 画像が返る（GI-3 と同じ形） |

### 3-5. stdio 結合（S の追加分）と wiring（W の追加分）

| ID | Given | When | Then |
|---|---|---|---|
| S-9 | モックの `/api/parts/2` が `image_path: '/uploads/test.png'`、`/uploads/test.png` が 1×1 の PNG を返す | 子プロセスの `callTool get_part_image { id: 2 }` | `content[0].type === 'image'`、`mimeType === 'image/png'`、`data` が元の PNG の Base64 と一致する |
| S-10 | `/api/parts/3` が `image_path: null` | `get_part_image { id: 3 }` | テキストだけで、「画像が登録されていません」 |
| S-11 | 子プロセスに `EPM_IMAGE_MAX_BYTES=10` | `get_part_image { id: 2 }` | `isError: true`。本文に「大きすぎます」を含む。子プロセスは応答を続ける（続けて `listTools` が成功する） |
| S-12 | `EPM_MCP_READONLY=1` | `listTools` | 4 ツールで、`get_part_image` を含む（既存 S-8 の更新を兼ねる） |
| W-10 | ― | `mcp/tools/getPartImage.js` を検査 | `readOnlyHint: true` があり、`console.` を使っていない |
| W-11 | ― | `mcp/server.js` を検査 | `registerGetPartImageTool(` の呼び出しが `if (!readOnly)` より前にある |
| W-12 | ― | `docs/MCP.md` を検査 | `get_part_image` と `EPM_IMAGE_MAX_BYTES` を含む |

### 3-6. 回帰と実機での受入（U）

| ID | Given | When | Then |
|---|---|---|---|
| G-1 | 実装後 | ルートで `npm test` | server、client、scripts、mcp のすべてが成功する |
| G-2 | 実装後 | `git diff --stat main -- server client` | 差分が無い |
| U-1 | ローカルの API。写真付きの部品がある | `npx @modelcontextprotocol/inspector node mcp/index.js` を実行し、`get_part_image { id }` を呼ぶ | Inspector に写真が表示され、テキストが「部品 ID … の登録写真です。」になる |
| U-2 | Claude Desktop に設定済み（LAN、`EPM_AUTH_TOKEN` あり） | 「部品 ID <n> の写真を見て、チップの刻印を読んで」 | AI が `get_part_image` を使い、写真の刻印を答える |
| U-3 | 名前が仮（例: 「黒い IC」）で、写真に型番が写っている部品 | 「この部品の写真から型番を読んで、名前と型番を直して」 | AI が `get_part_image` → 確認 → 更新系ツールの順で提案する（書き込みはユーザーの承認後） |
| U-4 | 画像の無い部品 | `get_part_image` | 「画像が登録されていません」と返り、エラーにならない |
| U-5 | 存在しない ID | 同上 | 「見つかりません」のエラー |
| U-6 | AWS（CloudFront の URL）と `EPM_BASIC_AUTH` | 写真付きの部品で `get_part_image` | 写真が返る（Basic 認証付きで `/uploads` から取得できる） |
| U-7 | AWS で、S3 から画像ファイルだけを消した部品（または DB の `image_path` を存在しないファイル名にした検証用の部品） | 同上 | 「画像ではなく text/html が返りました」のエラーで、HTML を画像として返さない |
| U-8 | 1MB を超える PNG を登録した部品 | Claude Desktop で `get_part_image` | 画像に注意文が付いて返る。Claude Desktop で表示できなかった場合は、その挙動と注意文を `docs/MCP.md` の記述と照合する |
| U-9 | `EPM_MCP_READONLY=1` | Claude Desktop のツール一覧 | `get_part_image` が表示され、使える |

---

## 4. 確認事項

### 🚨 必須（ブロッキング）

なし。要件はすべて本書の方針で実現できる。

### 💡 任意（ノンブロッキング、推奨案あり）

1. **大きな画像の扱い（D5）**
   - 推奨: 要件の 10MB をメモリを守る上限（`EPM_IMAGE_MAX_BYTES`）とし、750KB を超えたら画像を返しつつ注意文を添える二段構えにする。
   - Claude Desktop には 1MiB 前後のツール結果の上限があるという報告があり、Base64 で約 4/3 倍になるため、約 750KB を超える画像は表示できない可能性がある。
   - 本アプリの JPEG（長辺 1200px、品質 80）は通常この範囲に収まる。再圧縮しない PNG / GIF は超えることがある。
   - 確実に表示したくなったら、サーバーに縮小版を返す API（例: `GET /api/parts/:id/image?max=800`。サーバーには sharp がある）を足す別 Issue にする。
2. **画像の取得に失敗したときの扱い**
   - 推奨: `isError: true` にする（「画像が無い」とは区別する）。
   - DB に登録があるのにファイルが無いのは異常なので、AI に「写真は無い」と誤解させず、修復のきっかけにする。
3. **保管場所の画像**
   - 推奨: 今回は対象外。同じ部品（`image.js` と `getImage`）で数行で足せるので、必要になったら `get_location_image` として別 Issue にする。
4. **他オリジンや `/uploads` の外の取得を拒否すること（D1）**
   - 推奨: 拒否する。要件には無い制限だが、認証ヘッダーを他のホストへ漏らさないことと、認証付きで任意の API を取得されないことのため。現状の `image_path` は常に `/uploads/...` なので、正常系への影響は無い。
5. **MIME の判定順**
   - 推奨: 先頭バイトを最優先にし、`Content-Type`、拡張子、既定の `image/jpeg` の順にする。
   - 要件は `Content-Type` か拡張子での判定だが、S3 の `Content-Type` の誤りや、拡張子と実体の不一致に強くなる。

---

## 5. 補足

- 本計画書は `.gitignore` の `docs/*-plan.md` に該当する。PR に含める場合は `git add -f docs/issue-91-plan.md` が必要。
- 1MiB の上限の根拠は公式文書ではなく、第三者の MCP サーバーの README による報告（例: [Sogni Creative Agent](https://unpkg.com/@sogni-ai/sogni-creative-agent-skill@3.14.0/desktop-extension/README.md)、[openai-gpt-image-mcp](https://cdn.jsdelivr.net/gh/surescaleai/openai-gpt-image-mcp@master/README.md)）。U-8 で実機の挙動を確かめる。
