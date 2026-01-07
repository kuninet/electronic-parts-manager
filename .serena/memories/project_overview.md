# プロジェクト概要
**電子パーツ管理アプリ (Electronic Parts Manager)**

カテゴリ、保管場所、タグ機能を用いて電子パーツの在庫を管理するためのWebアプリケーションです。

## 技術スタック
-   **フロントエンド**: Vue 3 (Composition API) + Vite
-   **バックエンド**: Node.js + Express
-   **データベース**: SQLite (`server/database.sqlite`)
-   **スタイリング**: Vanilla CSS (グラスモーフィズムデザイン)
-   **言語**: JavaScript (`.js`, `.vue`)

## プロジェクト構造
-   `client/`: フロントエンド Vue.js アプリケーション
    -   `src/`: ソースコード
    -   `vite.config.js`: Vite 設定ファイル
-   `server/`: バックエンド Express アプリケーション
    -   `routes/`: API エンドポイント
    -   `database.js`: DB接続・マイグレーション
    -   `uploads/`: 画像・PDF 保存先
-   `docs/`: プロジェクトドキュメント

## 用途
-   小〜中規模の電子部品在庫管理向け。
-   画像アップロード、PDFデータシート管理、一括編集、マスタデータの並び替え（ドラッグ＆ドロップ）機能をサポート。