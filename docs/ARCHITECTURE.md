# システムアーキテクチャ

## 技術スタック

### フロントエンド
-   **フレームワーク**: Vue 3 (Composition API, `<script setup>`)
-   **ビルドツール**: Vite
-   **HTTPクライアント**: Axios
-   **スタイル**: Vanilla CSS (Scoped CSS)

### バックエンド
-   **ランタイム**: Node.js
-   **フレームワーク**: Express
-   **データベース**: SQLite3 (`sqlite` & `sqlite3` driver)
-   **ファイルアップロード**: Multer
-   **バックアップ**: Archiver (ZIP作成), Adm-ZIP (ZIP解凍), CSV-Stringify/Parse

## ディレクトリ構造

```
電子パーツ管理アプリ/
├── client/                 # フロントエンド (Vue.js + Vite)
│   ├── public/
│   ├── src/
│   │   ├── assets/
│   │   ├── components/     # Vueコンポーネント (PartForm.vue, PartsList.vue, DataManagement.vue 等)
│   │   ├── App.vue         # ルートコンポーネント
│   │   ├── api.js          # Axiosインスタンス設定
│   │   ├── main.js         # エントリーポイント
│   │   └── style.css       # グローバルスタイル
│   ├── index.html
│   ├── vite.config.js      # Vite設定 (プロキシ設定含む)
│   └── package.json
│
├── server/                 # バックエンド (Express + SQLite)
│   ├── routes/             # APIルート定義
│   │   ├── parts.js        # パーツCRUD操作
│   │   ├── categories.js   # カテゴリ管理
│   │   ├── locations.js    # 保管場所管理
│   │   ├── tags.js         # タグ管理
│   │   └── backup.js       # インポート/エクスポート/リセット機能
│   ├── database.js         # DB初期化・接続管理
│   ├── index.js            # エントリーポイント
│   ├── package.json
│   └── database.sqlite     # SQLiteデータベースファイル (自動生成)
│
├── uploads/                # アップロードされた画像・PDF (gitignore対象)
└── docs/                   # ドキュメント (本フォルダ)
```

## データフローの概要

1.  **クライアント**: Vueコンポーネントがユーザー操作を受け付け、`api.js` (Axios) を通じてリクエストを送信。
2.  **プロキシ**: Vite開発サーバー (`vite.config.js`) が `/api` へのリクエストを `localhost:3001` (Express) に転送。
3.  **サーバー**: Expressサーバー (`server/index.js`) がリクエストを受け取り、`routes/` 内の適切なハンドラにルーティング。
4.  **データベース**: ハンドラが `database.js` を通じてSQLiteを操作。
5.  **ファイル**: 画像やPDFは `uploads/` フォルダに保存され、Expressの静的ファイル配信機能 (`/uploads`) を通じてアクセス可能。
