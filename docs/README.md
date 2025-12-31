# 電子パーツ管理アプリ ドキュメント

このフォルダには、アプリケーションの開発・保守運用に必要な詳細ドキュメントが含まれています。

## ドキュメント一覧

-   **[システムアーキテクチャ (ARCHITECTURE.md)](./ARCHITECTURE.md)**
    -   システムの全体構成、ディレクトリ構造、使用技術スタックについて解説しています。
-   **[データベース設計 (DATABASE.md)](./DATABASE.md)**
    -   SQLiteのテーブル定義、ER図（テキストベース）、リレーションについて解説しています。
-   **[API仕様書 (API.md)](./API.md)**
    -   バックエンドが提供するREST APIのエンドポイント詳細です。
-   **[フロントエンド設計 (FRONTEND.md)](./FRONTEND.md)**
    -   Vue.jsコンポーネントの構造、画面遷移、状態管理について解説しています。

## 開発の始め方

### 必須要件
-   Node.js (v18以上推奨)
-   npm

### インストール
```bash
# プロジェクトのルートディレクトリで実行
npm install
cd server && npm install
cd ../client && npm install
```

### 起動方法
サーバー（バックエンド）とクライアント（フロントエンド）を別々のターミナルで起動します。

**ターミナル1 (バックエンド)**
```bash
cd server
npm start
# サーバーは http://localhost:3001 で起動します
```

**ターミナル2 (フロントエンド)**
```bash
cd client
npm run dev
# ブラウザで http://localhost:5173 にアクセスしてください
```
