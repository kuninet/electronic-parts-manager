# 推奨コマンド

## 開発 (Development)
-   **全体起動 (Client + Server)**:
    -   `./start_app.sh` (Mac/Linux)
    -   `start_app.bat` (Windows)
    -   または手動で: `client/` で `npm run dev` かつ `server/` で `node index.js`

## クライアント (`/client`)
-   `npm install`: 依存関係のインストール
-   `npm run dev`: Vite 開発サーバー起動 (デフォルトポート 3000)
-   `npm run build`: 本番ビルド

## サーバー (`/server`)
-   `npm install`: 依存関係のインストール
-   `node index.js`: バックエンドサーバー起動 (デフォルトポート 3001)
-   `node check_db.js`: DBファイルの状態確認ユーティリティ