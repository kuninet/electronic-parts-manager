# コーディング規約 (Coding Conventions)

## 全般
-   **言語**: 日本語を使用 (コメント、コミットメッセージ、UIテキスト)
-   **スタイル**: 標準的な JavaScript/Vue スタイル。
-   **フォーマット**: 厳密なLinterは強制されていませんが、既存コードとの整合性を保つこと。

## フロントエンド (Vue 3)
-   `<script setup>` を使用する。
-   状態管理には `ref` を使用する。
-   バックエンド呼び出しには `api.js` (共通 Axios インスタンス) を使用する。
-   スタイル: Scoped CSS または `src/style.css` (グローバル) を使用。

## バックエンド (Express)
-   DB操作には `async/await` を使用する。
-   `database.js` の `getDb()` ヘルパー経由で `sqlite3` ドライバーを使用する。
-   ルート定義は `routes/` ディレクトリ内でリソースごとに分割する。

## マスタデータ
-   `categories`, `locations`, `tags` テーブルには `display_order` カラムが存在する。
-   マスタ取得系APIでは、必ず `ORDER BY display_order ASC` を指定すること。