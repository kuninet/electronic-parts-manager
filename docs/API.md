# API仕様書

## 1. 概要
- エンドポイントのベースURLは、開発・ローカル環境では `http://localhost:3001` です。
- 全てのAPIは `/api` プレフィックスを持ちます。
- AWS本番環境（Lambda環境）ではCloudFront経由でアクセスされ、直接アクセス遮断のため `x-origin-verify` リクエストヘッダーが必須です（未設定・不一致の場合は `403 Forbidden`）。

---

## 2. この文書の運用ルール
1. **実装と文書の一致**: ルートを追加・変更・削除した際は、必ず同一のPull Request内で本仕様書（`docs/API.md`）も更新してください。
2. **自動テストによる保証**: `scripts/test/apiEndpoints.test.js` により、サーバーの全ルートと本仕様書の見出しが完全に双方向一致（過不足なし・重複なし）していることが自動検証されます。
3. **ルート定義を正とする原則**: 仕様書の記載と `server/routes/*.js` の実装が食い違う場合は、常に**サーバー実装（ルート定義）を正**とし、仕様書の誤記を改訂対象として扱ってください。

---

## 3. 共通事項

### 認証 (API トークン認証)

本システムは、LAN 内運用および MCP サーバー連携向けに **API トークン認証**（オプトイン）をサポートします。

- **有効化**: 環境変数 `EPM_API_TOKEN` に任意の文字列（例: 32バイト乱数の base64url）を設定すると有効化されます。未設定または空の場合は無認証で動作します（後方互換性維持）。
- **認証方式**: リクエストヘッダーに `Authorization: Bearer <token>` を指定します。
- **未認証・認証失敗時のレスポンス**:
  - HTTP ステータス: `401 Unauthorized`
  - レスポンスヘッダー: `WWW-Authenticate: Bearer realm="epm"`
  - レスポンスボディ:
    ```json
    {
      "error": "Unauthorized",
      "code": "API_TOKEN_REQUIRED"
    }
    ```
- **免除されるリクエスト**:
  - `OPTIONS` プリフライトリクエスト
  - `GET` および `HEAD` の `/api/health`（死活監視・更新スクリプト用）
  - AWS Lambda 環境における `POST /api/backup/export/worker`（非同期エクスポートワーカー内部呼出用。LAN環境では免除されません）
  - ※ループバックアドレス（`127.0.0.1` / `::1`）からの要求であっても免除されません（Vite preview プロキシ経由時のバイパス防止のため）。
- **対象外のパス**:
  - `/uploads/*` の静的画像・データシート配信（ブラウザの `<img>` や `<a>` タグからヘッダー付与が困難なため保護対象外）。
- **AWS 本番環境での扱い**:
  - AWS 環境では CloudFront の Basic 認証が `Authorization` ヘッダーを使用するため、同一ヘッダーを奪い合う `Authorization: Bearer` 方式のトークン認証は併用できません。AWS 環境では従来どおり CloudFront Basic 認証のみで保護し、`EPM_API_TOKEN` は設定しません。

### エラー形式
エラー時のレスポンスボディは原則として以下のJSON形式です。
```json
{
  "error": "エラーメッセージ文字列"
}
```

### ID の検証規則
以下のエンドポイントでは、パスパラメータ `:id` に正の整数の厳密な検証を行います（不正なら 400 `Invalid ID`）:
- `DELETE /api/parts/:id`
- `DELETE /api/parts/:id/permanent`
- `POST /api/parts/:id/restore`
- `DELETE /api/categories/:id`
- `DELETE /api/locations/:id`

※その他のエンドポイントでは、存在しない ID に対して 404 または空データを返却します。

### パーツの状態定義
パーツテーブル（`parts`）のレコードは、2つのタイムスタンプカラムによって以下の3つの状態に分類されます。

| 状態 | `deleted_at` | `used_at` | 説明 |
|---|---|---|---|
| **通常パーツ (active)** | `NULL` | `NULL` | 通常の在庫一覧に表示される現役パーツ |
| **使用済みパーツ (used)** | `NULL` | NOT NULL | 実装・製作等で使用され保管場所から出たパーツ（`used_at`, `used_for`, `used_note` を保持） |
| **ゴミ箱内パーツ (trash)** | NOT NULL | 任意 | 削除操作によりゴミ箱に入ったパーツ。通常・使用済み一覧からは除外される |

---

## 4. パーツ管理 (`/api/parts`)

#### `GET /api/parts`
- **用途**: パーツ一覧を検索・フィルタ・ソートして取得します。
- **リクエスト**:
  - クエリパラメータ:
    - `search` (string): 検索キーワード（名前、型番、説明の部分一致）
    - `category_id` (number): カテゴリIDで絞り込み
    - `location_id` (number): 保管場所IDで絞り込み
    - `tag_id` (number): タグIDで絞り込み
    - `status` (string): `'trash'`（ゴミ箱）、`'used'`（使用済み）、未指定時は通常パーツ
    - `used_for` (string): 用途キーワードで絞り込み
    - `sort` (string): ソートキー (`name`, `category`, `location`, `created_at`, `quantity`, `used_for`, `used_at`, `part_number`)
    - `order` (string): 並び順 (`ASC`, `DESC`)。デフォルトは `DESC`
- **レスポンス**: 200 OK
  ```json
  [
    {
      "id": 1,
      "name": "抵抗 10kΩ",
      "part_number": "CF1/4W-10k",
      "description": "カーボン抵抗 1/4W",
      "quantity": 100,
      "category_id": 2,
      "location_id": 3,
      "image_path": "/uploads/123.jpg",
      "datasheet_url": "https://example.com/sheet.pdf",
      "qr_code": "P-0001",
      "used_at": null,
      "used_for": null,
      "used_note": null,
      "deleted_at": null,
      "category_name": "受動部品",
      "location_name": "引き出しA-1",
      "tags": "抵抗,リード部品"
    }
  ]
  ```
- **エラー**: 500
- **副作用**: なし

#### `GET /api/parts/stats`
- **用途**: 在庫統計（通常、使用済み、ゴミ箱、在庫切れ、在庫少、カテゴリ別件数、保管場所数、AI判定保留数）を取得します。
- **リクエスト**: なし
- **レスポンス**: 200 OK
  ```json
  {
    "active": 120,
    "used": 15,
    "trash": 3,
    "lowStock": 4,
    "outOfStock": 1,
    "locations": 10,
    "aiPending": 2,
    "categories": [
      { "id": 1, "name": "IC", "count": 25 }
    ],
    "uncategorized": 5,
    "lowStockThreshold": 5
  }
  ```
- **エラー**: 500
- **副作用**: なし

#### `GET /api/parts/:id`
- **用途**: 指定したIDのパーツ詳細情報を取得します。
- **リクエスト**: パスパラメータ `:id`（正の整数）
- **レスポンス**: 200 OK（パーツオブジェクト）。存在しない場合は 404
- **エラー**: 404 `{ error: "Part not found" }`, 500
- **副作用**: なし

#### `POST /api/parts`
- **用途**: 新規パーツを登録します（`multipart/form-data` または `application/json` に対応）。
- **リクエスト**: `multipart/form-data` または `application/json`
  - ボディ:
    - `name` (string, 必須): 部品名（1〜200文字、前後の空白は自動トリム）
    - `part_number` (string, 任意): 型番（最大100文字）
    - `description` (string, 任意): 説明
    - `category_id` (number, 任意): カテゴリID（存在する正の整数）
    - `location_id` (number, 任意): 保管場所ID（存在する正の整数）
    - `quantity` (number, 任意): 数量（0以上の整数。デフォルト: 0）
    - `tags` (string | array, 任意): カンマ区切りタグ文字列、または文字列の配列
    - `datasheet_url` (string, 任意): データシートURL
    - `image` (file, 任意, multipartのみ): 画像ファイル（最大20MB、JPG/PNG/GIF/WEBP）
    - `datasheet` (file, 任意, multipartのみ): データシートPDFファイル（最大20MB）
- **レスポンス**: 201 Created (`{ id: <新パーツID> }`)
- **エラー**: 400（必須項目不足、不正な数量、存在しない外部キー等）、413（ファイルサイズ超過）、500
- **副作用**: パーツレコード作成、タグ紐付け、画像・データシート保存

#### `POST /api/parts/:id/quantity`
- **用途**: パーツの在庫数量を増減または絶対値で原子的に更新します（MCPツールや入庫処理向け）。
- **リクエスト**: `application/json`
  - パスパラメータ: `:id` (正の整数)
  - ボディ:
    - `delta` (number, 任意): 増減値（0以外の整数。正で増加、負で減少）。`absolute` との排他指定。
    - `absolute` (number, 任意): 設定する絶対値（0以上の整数）。`delta` との排他指定。
    - `reason` (string, 任意): 変更理由（最大200文字。サーバーログおよびレスポンスに反映）。
- **レスポンス**: 200 OK
  ```json
  {
    "part_id": 1,
    "previous_quantity": 10,
    "new_quantity": 15,
    "delta": 5,
    "reason": "秋月で購入"
  }
  ```
- **エラー**:
  - 400: 不正なID、`delta` と `absolute` の未指定または重複指定、小数の指定、200文字超の理由、計算後の在庫数が負になる場合
  - 404: パーツが存在しない、またはゴミ箱（`deleted_at IS NOT NULL`）もしくは使用済み（`used_at IS NOT NULL`）の場合
  - 500: サーバー内部エラー
- **副作用**: `parts.quantity` および `parts.updated_at` の更新（`absolute` で数量不変の場合は `updated_at` を更新しない）、サーバーログへの出力

#### `PUT /api/parts/:id`
- **用途**: パーツ情報を包括的に更新します（マルチパート対応）。
- **リクエスト**: `multipart/form-data`
  - パスパラメータ: `:id`
  - ボディ: `POST /api/parts` と同様のフィールド。`part_number` が未送信の場合は既存値を保持、空文字の場合はNULLクリア。
- **レスポンス**: 200 OK（更新後のパーツオブジェクト）
- **エラー**: 400（入力不備・画像破損等）、409（QRコード重複）、413（ファイルサイズ超過）、500
- **副作用**: 新規ファイル添付時の古いファイルの削除（S3またはローカル）、タグ付けの更新

#### `PATCH /api/parts/:id`
- **用途**: パーツの指定フィールドのみを部分更新します（数量ステッパー操作や即時フィールド更新で使用）。
- **リクエスト**: `application/json`
  - パスパラメータ: `:id`
  - ボディ: 更新対象のキー・値のオブジェクト（`quantity`, `name`, `part_number`, `description`, `category_id`, `location_id`, `tags` など）
- **レスポンス**: 200 OK（更新後のパーツオブジェクト）
- **エラー**: 400（更新キーなし・不正なID等）、404（パーツが存在しない、または**ゴミ箱内にある**）、409（QRコード重複）、500
- **副作用**: 該当フィールドの更新、`updated_at` の現在時刻更新

#### `DELETE /api/parts/:id`
- **用途**: パーツをゴミ箱へ移動します（論理削除）。
- **リクエスト**: パスパラメータ `:id`
- **レスポンス**: 200 OK
  ```json
  {
    "message": "Moved to trash",
    "id": 1
  }
  ```
- **エラー**: 400（ID不正）、404（パーツが見つからないか、既にゴミ箱にある）、500
- **副作用**: `deleted_at` に現在時刻を設定し、**`qr_code` を NULL に初期化します**（QRコードを即時再利用可能にするため。復元しても戻りません）。

#### `DELETE /api/parts/:id/permanent`
- **用途**: ゴミ箱内のパーツを 1 件完全に削除します（取り消し不可）。
- **リクエスト**: パスパラメータ `:id`
- **レスポンス**: 200 OK
  ```json
  {
    "message": "Permanently deleted",
    "affected": 1
  }
  ```
- **エラー**: 400（ID不正）、404（パーツが見つからないか、ゴミ箱にない。**ゴミ箱外のパーツは完全削除できません**）、500
- **副作用**:
  - `storage_logs` の対象パーツの履歴行を削除
  - `part_tags` および `ai_name_suggestions` は CASCADE により自動削除
  - DB確定後に画像およびデータシートファイル（S3またはローカル）をストレージから完全削除

#### `POST /api/parts/:id/restore`
- **用途**: ゴミ箱内のパーツを 1 件復元します。
- **リクエスト**: パスパラメータ `:id`
- **レスポンス**: 200 OK
  ```json
  {
    "message": "Restored successfully",
    "id": 1
  }
  ```
- **エラー**: 400（ID不正）、404（パーツが見つからないか、ゴミ箱にない）、500
- **副作用**: `deleted_at` を `NULL` にクリア。元のパーツに `used_at` があった場合は使用済みパーツとして復元されます。QRコードは戻りません。保管場所が削除済みだった場合は `location_id` は NULL（場所未設定）のままとなります。

#### `POST /api/parts/:id/unuse`
- **用途**: 使用済みパーツを通常在庫に復帰させます。
- **リクエスト**: パスパラメータ `:id`
- **レスポンス**: 200 OK
  ```json
  {
    "message": "Part restored to active inventory"
  }
  ```
- **エラー**: 500
- **副作用**: `used_at`, `used_for`, `used_note` を `NULL` にクリアし、`updated_at` を更新します。

#### `POST /api/parts/bulk/action`
- **用途**: 複数のパーツに対して一括操作（ゴミ箱移動、復元、完全削除）を実行します。
- **リクエスト**: `application/json`
  ```json
  {
    "action": "trash",
    "ids": [1, 2, 3]
  }
  ```
  - `action`:
    - `'trash'`: ゴミ箱へ移動（`deleted_at` 設定、`qr_code = NULL` 解除。対象はゴミ箱外のパーツのみ）
    - `'restore'`: ゴミ箱から復元（`deleted_at = NULL`。対象はゴミ箱内のパーツのみ）
    - `'delete'`: **完全削除（復元不可）**。付随入庫ログ・画像ファイルも削除（対象はゴミ箱内のパーツのみ）
  - `ids`: 正の整数の配列（1〜500件、重複は自動除去）
- **レスポンス**: 200 OK
  ```json
  {
    "message": "Moved 3 items to trash",
    "affected": 3
  }
  ```
  ※`affected` には実際に処理された件数が返ります。対象外の状態のパーツは処理されず除外されます（エラーにはなりません）。
- **エラー**: 400（`ids` 不正・件数超過、`action` 不正）、500
- **副作用**: アクションに応じた状態遷移、ファイル削除、QRコード解除

#### `POST /api/parts/bulk/update`
- **用途**: 複数のパーツのカテゴリ・保管場所・タグを一括変更します。
- **リクエスト**: `application/json`
  ```json
  {
    "ids": [1, 2, 3],
    "updates": {
      "category_id": 2,
      "location_id": 5,
      "add_tags": ["高精度"],
      "remove_tags": ["旧製品"]
    }
  }
  ```
  - `ids`: 正の整数の配列（1〜500件）
  - `updates`:
    - `category_id`: カテゴリID、または `null` / `""` で解除
    - `location_id`: 保管場所ID、または `null` / `""` で解除
    - `add_tags`: 追加するタグ名配列
    - `remove_tags`: 削除するタグ名配列
- **レスポンス**: 200 OK
  ```json
  {
    "message": "Updated 3 items"
  }
  ```
- **エラー**: 400（`ids` 不正、`updates` なし）、500
- **副作用**: 対象パーツのカテゴリ・保管場所・タグ付けの更新

#### `PUT /api/parts/:id/qr`
- **用途**: 既存パーツにQRコードを紐付けます。
- **リクエスト**: `application/json`
  - パスパラメータ: `:id`
  - ボディ: `{ "qr_code": "P-0001" }`
- **レスポンス**: 200 OK `{ "message": "QRコードを紐付けました" }`
- **エラー**: 409（QRコードが別のパーツまたは保管場所に登録済み）、500
- **副作用**: パーツの `qr_code` と `updated_at` を更新

---

## 5. マスタデータ管理 (`/api/categories`, `/api/locations`, `/api/tags`, `/api/master`)

### カテゴリ (`/api/categories`)

#### `GET /api/categories`
- **用途**: 全カテゴリの一覧を表示順昇順で取得します。
- **リクエスト**: なし
- **レスポンス**: 200 OK
  ```json
  [
    { "id": 1, "name": "IC", "display_order": 0 }
  ]
  ```
- **エラー**: 500
- **副作用**: なし

#### `POST /api/categories`
- **用途**: 新規カテゴリを作成します。
- **リクエスト**: `application/json` `{ "name": "センサー" }`
- **レスポンス**: 201 Created `{ "id": 2, "name": "センサー", "display_order": 1 }`
- **エラー**: 500
- **副作用**: カテゴリの作成、末尾の `display_order` 自動割り当て

#### `PUT /api/categories/:id`
- **用途**: カテゴリ名を変更します。
- **リクエスト**: `application/json` `{ "name": "高精度センサー" }`
- **レスポンス**: 200 OK `{ "message": "Category updated" }`
- **エラー**: 500
- **副作用**: カテゴリ名の更新

#### `DELETE /api/categories/:id`
- **用途**: カテゴリを削除します。
- **リクエスト**: パスパラメータ `:id`
- **レスポンス**: 200 OK
  ```json
  {
    "message": "Category deleted",
    "detachedTrashedParts": 1
  }
  ```
- **エラー**:
  - 400: ID不正。または**ゴミ箱外（通常・使用済み）**のパーツがこのカテゴリに残っている（エラー文に件数を含む）
  - 404: カテゴリが存在しない
  - 500
- **副作用**: ゴミ箱内のパーツの `category_id` を NULL（未分類）に解除した上で、カテゴリを削除します。

---

### 保管場所 (`/api/locations`)

#### `GET /api/locations`
- **用途**: 全保管場所の一覧を表示順昇順で取得します。
- **リクエスト**: なし
- **レスポンス**: 200 OK
  ```json
  [
    {
      "id": 1,
      "name": "棚A-1",
      "description": "電子部品棚 1段目",
      "image_path": "/uploads/loc-1.jpg",
      "qr_code": "LOC-001",
      "display_order": 0
    }
  ]
  ```
- **エラー**: 500
- **副作用**: なし

#### `POST /api/locations`
- **用途**: 新規保管場所を作成します（画像添付対応）。
- **リクエスト**: `multipart/form-data`
  - ボディ: `name` (必須), `description` (任意), `image` (file, 任意)
- **レスポンス**: 201 Created `{ "id": 1, "name": "棚A-1", "description": "", "image_path": "/uploads/...", "display_order": 0 }`
- **エラー**: 400（画像形式不正・破損等）、413（ファイルサイズ超過）、500
- **副作用**: 画像アップロード保存、末尾の `display_order` 自動割り当て

#### `PUT /api/locations/:id`
- **用途**: 保管場所情報（名前、説明、QRコード、画像）を更新します。
- **リクエスト**: `multipart/form-data`
  - ボディ: `name` (必須), `description` (任意), `qr_code` (任意), `image` (file, 任意)
- **レスポンス**: 200 OK `{ "message": "Location updated" }`
- **エラー**: 400（画像形式不正等）、409（QRコード重複）、413（ファイルサイズ超過）、500
- **副作用**: 画像更新時の古いファイルの削除、QRコード重複検証

#### `DELETE /api/locations/:id`
- **用途**: 保管場所を削除します。
- **リクエスト**: パスパラメータ `:id`
- **レスポンス**: 200 OK
  ```json
  {
    "message": "Location deleted",
    "detachedTrashedParts": 2,
    "deletedLogs": 3
  }
  ```
- **エラー**:
  - 400: ID不正。または**ゴミ箱外（通常・使用済み）**のパーツがこの場所にある（エラー文に件数を含む）
  - 404: 保管場所が存在しない
  - 500
- **副作用**:
  - ゴミ箱内のパーツの `location_id` を NULL（場所未設定）に解除
  - この保管場所宛ての入庫履歴（`storage_logs`）を全削除
  - DB確定後に保管場所の登録画像ファイルをストレージから削除

---

### タグ (`/api/tags`)

#### `GET /api/tags`
- **用途**: 全タグの一覧を表示順昇順で取得します。
- **リクエスト**: なし
- **レスポンス**: 200 OK `[{ "id": 1, "name": "表面実装", "display_order": 0 }]`
- **エラー**: 500
- **副作用**: なし

#### `POST /api/tags`
- **用途**: 新規タグを作成します。
- **リクエスト**: `application/json` `{ "name": "表面実装" }`
- **レスポンス**: 201 Created `{ "id": 1, "name": "表面実装", "display_order": 0 }`
- **エラー**: 400（名前なし）、500
- **副作用**: タグ作成、末尾の `display_order` 自動割り当て

#### `PUT /api/tags/:id`
- **用途**: タグ名を変更します。
- **リクエスト**: `application/json` `{ "name": "SMD" }`
- **レスポンス**: 200 OK `{ "id": "1", "name": "SMD" }`
- **エラー**: 400（名前なし）、500
- **副作用**: タグ名の更新

#### `DELETE /api/tags/:id`
- **用途**: タグを削除します。
- **リクエスト**: パスパラメータ `:id`
- **レスポンス**: 200 OK `{ "message": "Deleted successfully" }`
- **エラー**: 500
- **副作用**: `part_tags` の紐付けレコードは CASCADE により自動削除

---

### 並び順一括保存 (`/api/master/reorder`)

#### `POST /api/master/reorder`
- **用途**: カテゴリ、保管場所、タグのドラッグ＆ドロップ並び順を一括保存します。
- **リクエスト**: `application/json`
  ```json
  {
    "type": "categories",
    "ids": [3, 1, 2]
  }
  ```
  - `type`: `'categories'` | `'locations'` | `'tags'`
  - `ids`: 配列インデックス順が新しい `display_order` (0, 1, 2...) に反映されるID配列
- **レスポンス**: 200 OK `{ "message": "Reordered" }`
- **エラー**: 400（無効な type または ids）、500
- **副作用**: トランザクション内で該当テーブルの `display_order` を一括更新

---

## 6. QRコード管理 (`/api/qr`)

#### `GET /api/qr/lookup/:qrCode`
- **用途**: スキャンしたQRコードから該当する保管場所（中身のパーツ含む）またはパーツ情報を逆引きします。
- **リクエスト**: パスパラメータ `:qrCode`
- **レスポンス**: 200 OK
  - 保管場所の場合: `{ "type": "location", "data": { ...location, "parts": [...] } }`
  - パーツの場合: `{ "type": "part", "data": { ...part, "category_name": "...", "location_name": "..." } }`
  - 未登録の場合: `{ "type": "unknown", "data": null }`
- **エラー**: 500
- **副作用**: なし

#### `POST /api/qr/store`
- **用途**: パーツを保管場所に「しまう」（紐付け）し、入庫ログ（`storage_logs`）を記録します。すでに同じ保管場所にある場合は更新・ログ追加を行わず `unchanged: true` を返します。
- **リクエスト**: `application/json`
  ```json
  {
    "part_id": 1,
    "location_id": 2,
    "memo": "棚の左奥に収納"
  }
  ```
- **レスポンス**: 200 OK
  - 新規移動時:
    ```json
    {
      "message": "保管場所にしまいました",
      "log_id": 123,
      "part_id": 1,
      "location_id": 2,
      "previous_location_id": 1,
      "previous_location_name": "棚A",
      "unchanged": false
    }
    ```
  - 同一保管場所時:
    ```json
    {
      "message": "既にこの保管場所にあります",
      "log_id": null,
      "part_id": 1,
      "location_id": 2,
      "previous_location_id": 2,
      "previous_location_name": "棚B",
      "unchanged": true
    }
    ```
- **エラー**:
  - 400（`part_id` または `location_id` が正の整数でない、または欠落）
  - 404（部品が見つからない［ゴミ箱・使用済みを含む］、または保管場所が見つからない）
  - 500
- **副作用**: パーツの `location_id` と `updated_at` の更新、`storage_logs` への履歴行追加（同一保管場所時は副作用なし）

#### `POST /api/qr/store/undo`
- **用途**: 直前の「しまう」操作を取り消し、部品を元の保管場所に戻します（入庫ログは削除）。
- **リクエスト**: `application/json`
  ```json
  {
    "log_id": 123
  }
  ```
- **レスポンス**: 200 OK
  ```json
  {
    "message": "取り消しました",
    "part_id": 1,
    "restored_location_id": 1,
    "restored_location_name": "棚A",
    "previous_location_missing": false
  }
  ```
- **エラー**:
  - 400（`log_id` が正の整数でない、または欠落）
  - 404（ログが存在しない、既に取り消し済み、または部品が見つからない）
  - 409（部品の現在の保管場所がログの移動先と異なる場合：その後に別の場所へ移されているため取り消し不可）
  - 500
- **副作用**: パーツの `location_id` と `updated_at` を移動前の保管場所に復元、`storage_logs` の該当ログレコードを削除

#### `POST /api/qr/register-location`
- **用途**: QRスキャン画面から保管場所を新規登録します（画像添付対応）。
- **リクエスト**: `multipart/form-data`
  - ボディ: `qr_code` (必須), `name` (必須), `description` (任意), `image` (file, 任意)
- **レスポンス**: 201 Created `{ "id": 1, "qr_code": "LOC-001", "name": "棚A" }`
- **エラー**: 400（画像形式不正・破損等）、409（QRコード重複）、413（ファイルサイズ超過）、500
- **副作用**: 画像アップロード保存、QRコード重複チェック、保管場所レコードの作成

#### `POST /api/qr/register-part`
- **用途**: QRスキャン画面からパーツを新規登録します（画像添付対応）。
- **リクエスト**: `multipart/form-data`
  - ボディ: `qr_code` (必須), `name` (必須), `part_number` (任意), `description` (任意), `quantity` (任意), `category_id` (任意), `location_id` (任意), `image` (file, 任意)
- **レスポンス**: 201 Created `{ "id": 1, "qr_code": "P-001", "name": "LED" }`
- **エラー**: 400（型番バリデーションエラー・画像破損等）、409（QRコード重複）、413（ファイルサイズ超過）、500
- **副作用**: 画像アップロード保存、QRコード重複チェック、パーツレコードの作成

#### `PUT /api/qr/assign-location/:id`
- **用途**: 既存の保管場所にQRコードを紐付けます。
- **リクエスト**: `application/json` `{ "qr_code": "LOC-001" }`
- **レスポンス**: 200 OK `{ "message": "QRコードを紐付けました" }`
- **エラー**: 409（QRコード重複）、500
- **副作用**: 保管場所の `qr_code` 更新

#### `PUT /api/qr/assign-part/:id`
- **用途**: 既存のパーツにQRコードを紐付けます。
- **リクエスト**: `application/json` `{ "qr_code": "P-001" }`
- **レスポンス**: 200 OK `{ "message": "QRコードを紐付けました" }`
- **エラー**: 409（QRコード重複）、500
- **副作用**: パーツの `qr_code` と `updated_at` 更新

#### `GET /api/qr/storage-logs`
- **用途**: 入庫ログの履歴一覧を取得します。
- **リクエスト**:
  - クエリパラメータ: `part_id` (任意), `location_id` (任意), `limit` (任意、デフォルト50)
- **レスポンス**: 200 OK
  ```json
  [
    {
      "id": 1,
      "part_id": 10,
      "location_id": 2,
      "memo": null,
      "created_at": "2026-10-10 12:00:00",
      "part_name": "NE555P",
      "part_qr_code": "P-001",
      "location_name": "引き出しA",
      "location_qr_code": "LOC-001"
    }
  ]
  ```
- **エラー**: 500
- **副作用**: なし

---

## 7. AI 部品名判定 (`/api/ai-naming`)

#### `GET /api/ai-naming/status`
- **用途**: AI機能の有効状態、本日の実行件数、日次上限、デフォルトモデルを取得します。
- **リクエスト**: なし
- **レスポンス**: 200 OK
  ```json
  {
    "enabled": true,
    "todayCount": 12,
    "dailyLimit": 200,
    "defaultModel": "gemini-1.5-flash"
  }
  ```
- **エラー**: 500
- **副作用**: なし

#### `GET /api/ai-naming/models`
- **用途**: 利用可能なGeminiモデル一覧を取得します。
- **リクエスト**: なし
- **レスポンス**: 200 OK
  ```json
  [
    { "id": "gemini-1.5-flash", "name": "Gemini 1.5 Flash", "description": "高速・低コスト" }
  ]
  ```
- **エラー**: 500
- **副作用**: なし

#### `GET /api/ai-naming/suggestions`
- **用途**: 判定済み未採用（pending）の候補一覧を取得します。
- **リクエスト**: なし
- **レスポンス**: 200 OK（候補レコード配列）
- **エラー**: 500
- **副作用**: なし

#### `POST /api/ai-naming/suggest/:id`
- **用途**: 単一パーツの写真からGemini APIで部品名・型番・メーカー等を判定します。
- **リクエスト**: `application/json`
  - パスパラメータ: `:id`（パーツID）
  - ボディ: `{ "model": "gemini-1.5-flash", "force": false }`
- **レスポンス**: 200 OK（判定候補オブジェクト）
- **エラー**: 400, 429（日次上限到達）, 500
- **副作用**: 外部Gemini API呼び出し、`ai_name_suggestions` レコードの作成または更新

#### `POST /api/ai-naming/apply/:id`
- **用途**: 判定結果を採用してパーツ情報に反映します。
- **リクエスト**: `application/json`
  - パスパラメータ: `:id`（候補ID）
  - ボディ: `{ "name": "NE555P", "category_id": 1, "apply_category": true, "part_number": "NE555P" }`
- **レスポンス**: 200 OK（更新結果オブジェクト）
- **エラー**: 400（写真変更後の不整合等）, 500
- **副作用**: パーツ情報の更新、候補ステータスを `applied` に変更

#### `POST /api/ai-naming/apply-batch`
- **用途**: 複数の判定結果を一括採用します。
- **リクエスト**: `application/json`
  - ボディ: `items`（個別手直し配列）、`suggestion_ids`（ID配列）、または `min_confidence`（信頼度閾値）
- **レスポンス**: 200 OK
  ```json
  {
    "total": 5,
    "appliedCount": 5,
    "skippedCount": 0,
    "applied": [...],
    "skipped": []
  }
  ```
- **エラー**: 400, 500
- **副作用**: 対象パーツ情報の一括更新、各候補ステータスを `applied` に変更

#### `POST /api/ai-naming/reject/:id`
- **用途**: 判定結果を却下します。
- **リクエスト**: パスパラメータ `:id`（候補ID）
- **レスポンス**: 200 OK
- **エラー**: 500
- **副作用**: 候補ステータスを `rejected` に変更

#### `POST /api/ai-naming/reject-batch`
- **用途**: 複数の判定結果を一括却下します。
- **リクエスト**: `application/json` `{ "suggestion_ids": [1, 2, 3] }`
- **レスポンス**: 200 OK `{ "total": 3, "rejectedCount": 3, "rejected": [...] }`
- **エラー**: 400, 500
- **副作用**: 対象候補ステータスを `rejected` に変更

---

## 8. バックアップ・データ管理 (`/api/backup`)

#### `GET /api/backup/config`
- **用途**: バックアップのS3利用可否とバケット設定状態を取得します。
- **リクエスト**: なし
- **レスポンス**: 200 OK `{ "s3Enabled": true, "bucket": "my-backup-bucket" }`
- **エラー**: なし
- **副作用**: なし

#### `POST /api/backup/export/start`
- **用途**: 非同期エクスポートジョブを開始します（S3トリガー経由）。
- **リクエスト**: なし
- **レスポンス**: 202 Accepted `{ "jobId": "export_1728640000000" }`
- **エラー**: 500
- **副作用**: S3トリガーファイルの配置

#### `GET /api/backup/export/status`
- **用途**: 非同期エクスポートジョブの進捗状態を取得します。
- **リクエスト**: クエリパラメータ `jobId`
- **レスポンス**: 200 OK `{ "status": "running", "progress": 50, "message": "画像取得中..." }`
- **エラー**: 400（jobIdなし）、404（ジョブ不在）、500
- **副作用**: なし

#### `POST /api/backup/export/worker`
- **用途**: エクスポートワーカー（LambdaまたはS3イベントハンドラ）を実行します。
- **リクエスト**: `application/json` `{ "jobId": "export_..." }` または S3 Event JSON
- **レスポンス**: 200 OK `{ "done": true }`
- **エラー**: 400, 500
- **副作用**: 全DBダンプおよび添付画像ZIPの生成、S3へのアップロード、署名付きダウンロードURLの発行

#### `GET /api/backup/export/full`
- **用途**: 全データ（DB+画像+PDF）の同期ZIPエクスポートを取得します。
- **リクエスト**: なし
- **レスポンス**:
  - S3環境: 200 OK `{ "url": "https://...", "fileName": "full_backup_....zip" }`
  - ローカル環境: ZIPファイルの添付ダウンロード（`application/zip` ストリーム）
- **エラー**: 500
- **副作用**: ZIPアーカイブの生成

#### `POST /api/backup/import/full`
- **用途**: 小容量バックアップZIPファイルから完全復元します（マルチパート直接アップロード）。
- **リクエスト**: `multipart/form-data`（`file`: ZIPファイル）
- **レスポンス**: 200 OK `{ "message": "Full restore successful" }`
- **エラー**: 400（ファイルなし・Zip Slip検出）、500
- **副作用**: **既存の全データ（DB・画像）を完全消去**し、ZIP内のデータで上書き復元

#### `GET /api/backup/import/presigned-url`
- **用途**: 大容量バックアップファイルを直接S3へアップロードするための署名付きURLを発行します。
- **リクエスト**: クエリパラメータ `fileName` (任意)
- **レスポンス**: 200 OK `{ "url": "https://...", "key": "imports/..." }`
- **エラー**: 500
- **副作用**: S3 PUT署名付きURLの発行

#### `POST /api/backup/import/download`
- **用途**: S3にアップロードされた大容量バックアップZIPをサーバー側ローカル/EFS一時領域へダウンロードします（インポートStep 1）。
- **リクエスト**: `application/json` `{ "key": "imports/backup.zip" }`
- **レスポンス**: 200 OK `{ "message": "Download to EFS successful" }`
- **エラー**: 400（キー不正・パス走査検出）、500
- **副作用**: 一時ファイル `import_temp.zip` のダウンロード保存

#### `POST /api/backup/import/restore`
- **用途**: 一時領域にダウンロードされたZIPを展開し、完全復元を実行します（インポートStep 2）。
- **リクエスト**: `application/json` `{ "s3Key": "imports/backup.zip" }`
- **レスポンス**: 200 OK `{ "message": "Restore successful" }`
- **エラー**: 400, 404（一時ファイル不在）, 500
- **副作用**: **既存の全データ（DB・画像）を完全消去**して上書き復元、一時ファイルおよびS3アップロードファイルの削除

#### `POST /api/backup/reset`
- **用途**: パーツデータ・入庫ログ・アップロード画像ファイルを全消去します（マスタデータは保持）。
- **リクエスト**: なし
- **レスポンス**: 200 OK `{ "message": "Reset successful" }`
- **エラー**: 500
- **副作用**: `parts`, `part_tags`, `storage_logs` の全レコード削除、`uploads/` ディレクトリ内の全画像・PDFファイル削除

---

## 9. ヘルスチェック (`/api/health`)

#### `GET /api/health`
- **用途**: サーバー稼働状態およびデータベース疎通を確認します（自動更新スクリプトや死活監視用）。
- **リクエスト**: なし
- **レスポンス**:
  - 正常時: 200 OK `{ "status": "ok", "uptime": 123 }`
  - DB接続異常時: 503 Service Unavailable `{ "status": "error" }`
- **エラー**: 503
- **副作用**: なし

---

## 10. 付録: パーツの状態遷移図

```mermaid
stateDiagram-v2
    [*] --> 通常パーツ : POST /api/parts\n(新規登録)
    
    通常パーツ --> 使用済みパーツ : PUT /api/parts/:id\n(used_at 設定)
    使用済みパーツ --> 通常パーツ : POST /api/parts/:id/unuse\n(通常在庫に戻す)
    
    通常パーツ --> ゴミ箱内パーツ : DELETE /api/parts/:id\nまたは bulk/action "trash"\n(QRコード解除)
    使用済みパーツ --> ゴミ箱内パーツ : DELETE /api/parts/:id\nまたは bulk/action "trash"\n(QRコード解除)
    
    ゴミ箱内パーツ --> 通常パーツ : POST /api/parts/:id/restore\nまたは bulk/action "restore"\n(used_at なし)
    ゴミ箱内パーツ --> 使用済みパーツ : POST /api/parts/:id/restore\nまたは bulk/action "restore"\n(used_at あり)
    
    ゴミ箱内パーツ --> [*] : DELETE /api/parts/:id/permanent\nまたは bulk/action "delete"\n(DB行・画像・ログを完全削除)
```
