# API仕様書

## 概要
エンドポイントのベースURLは、開発環境では `http://localhost:3001` です。
全てのAPIは `/api` プレフィックスを持ちます。

## エンドポイント一覧

### パーツ管理 (`/api/parts`)

#### `GET /api/parts`
パーツ一覧を取得します。
-   **クエリパラメータ**:
    -   `search`: 検索キーワード (名前または説明)
    -   `category_id`: カテゴリIDでフィルタ
    -   `location_id`: 保管場所IDでフィルタ
    -   `tag_id`: タグIDでフィルタ
    -   `status`: `'trash'` を指定するとゴミ箱の中身を取得。指定なしで通常パーツ。
    -   `sort`: ソートキー (`name`, `category`, `location`, `quantity`, `created_at`)
    -   `order`: 並び順 (`ASC`, `DESC`)

#### `GET /api/parts/:id`
指定したIDのパーツ詳細情報を取得します。

#### `POST /api/parts`
新規パーツを登録します。
-   **Content-Type**: `multipart/form-data`
-   **Body**:
    -   `name` (必須)
    -   `description`
    -   `category_id` (必須)
    -   `location_id` (必須)
    -   `quantity`
    -   `tags`: カンマ区切りの文字列
    -   `image`: 画像ファイル
    -   `datasheet`: PDFファイル
    -   `datasheet_url`: 外部URL

#### `PUT /api/parts/:id`
パーツ情報を更新します。
-   **Content-Type**: `multipart/form-data`
-   **Body**: `POST /api/parts` と同様

#### `DELETE /api/parts/:id`
パーツを論理削除（ゴミ箱へ移動）します。

#### `DELETE /api/parts/:id/permanent`
パーツを完全に削除します（復元不可）。

#### `POST /api/parts/restore`
ゴミ箱のパーツを復元します。
-   **Body**: `{ ids: [1, 2, ...] }`

#### `POST /api/parts/bulk-delete`
複数のパーツを一括操作します。
-   **Body**: `{ ids: [1, 2, ...], permanent: boolean }`

#### `POST /api/parts/bulk-delete`
複数のパーツを一括操作します。
-   **Body**: `{ ids: [1, 2, ...], permanent: boolean }`

#### `POST /api/parts/bulk/update`
複数のパーツを一括更新します。
-   **Body**:
    -   `ids`: `[1, 2, ...]` (更新対象ID配列)
    -   `updates`:
        -   `category_id`: ID または `null` (解除)
        -   `location_id`: ID または `null` (解除)
        -   `add_tags`: `['TagA', ...]` (追加するタグ)
        -   `remove_tags`: `['TagB', ...]` (削除するタグ)

---

### マスタデータ管理
共通: 一覧取得APIは `display_order` (表示順) の昇順でソートされて返されます。

#### カテゴリ (`/api/categories`)
-   `GET /`: 一覧取得
-   `POST /`: 新規作成 (`{ name }`)
-   `PUT /:id`: 名称変更 (`{ name }`)
-   `DELETE /:id`: 削除
    -   ※使用中の場合は `400 Bad Request` を返却します。

#### 保管場所 (`/api/locations`)
-   `GET /`: 一覧取得
-   `POST /`: 新規作成 (`multipart/form-data`: `{ name, description, image }`)
-   `PUT /:id`: 更新 (`multipart/form-data`: `{ name, description, image }`)
-   `DELETE /:id`: 削除
    -   ※使用中の場合は `400 Bad Request` を返却します。

#### タグ (`/api/tags`)
-   `GET /`: 一覧取得
-   `POST /`: 新規作成 (`{ name }`)
-   `PUT /:id`: 名称変更 (`{ name }`)
-   `DELETE /:id`: 削除

#### 共通リオーダー (`/api/master/reorder`)
ドラッグ＆ドロップによる並び順を保存します。
-   **Method**: `POST`
-   **Body**: `{ type: 'categories'|'locations'|'tags', ids: [id1, id2, ...] }`

---

### バックアップ・データ管理 (`/api/backup`)

#### エクスポート
-   `GET /export/csv`: 全パーツデータをCSV形式でダウンロード
-   `GET /export/full`: 全データ（DB+画像+PDF）をZIP形式でダウンロード

#### インポート
-   `POST /import/csv`: CSVファイルからデータを復元（マージ）
-   `POST /import/excel`: Excelファイルからデータを簡易取り込み
-   `POST /import/full`: ZIPファイルから完全復元（**既存データは上書き**）

#### リセット
-   `POST /reset`: パーツデータ・アップロードファイルを全削除（マスタは保持）
