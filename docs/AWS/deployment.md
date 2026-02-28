# AWS サーバーレス インフラ構築・デプロイ手順 (ZIPアップロード方式)

このドキュメントでは、電子パーツ管理アプリをAWS環境（サーバーレス環境）に構築し、デプロイするための具体的な手順を解説します。
バックエンドはDockerコンテナ（ECR）を使わず、**ソースコードのZIPアップロードとLambda Layer**を利用する方式です。

## 0. 事前準備
1. **AWS CLIの設定**
   - `aws configure` コマンドで対象AWSアカウントのアクセス情報を設定済みであること。
2. **Node.js 環境**
   - バックエンドの依存関係(`node_modules`)をインストールしてZIP化するため、ローカルにNode.jsがインストールされていること。

---

## 1. データベース・ストレージ層（Amazon EFS）の構築

**目的**: バックエンドAPI（Lambda）が状態を永続化できるように、SQLiteの保存先および画像アップロード先となるEFSを用意します。

1. **VPC・セキュリティグループの確認**
   - 今回はデフォルトVPCを利用するか、専用のVPCを作成します。
   - EFS用のセキュリティグループを作成し、Lambda（後述）からのアクセス（NFS: ポート2049）を許可します。
2. **EFS ファイルシステムの作成**
   - マネジメントコンソールからEFSを作成します。
   - 作成後、**「アクセスポイント」** を一つ作成します。
     - *ユーザID/グループID*: `1000`
     - *権限*: `0777` （Lambda環境から書き込めるように適宜緩めにしておきます）
     - *パス*: `/`

---

## 2. バックエンド層（AWS Lambda + Layer）のデプロイ

**目的**: Expressで作られた既存のAPIを、ZIPファイルとしてAWS Lambda上で稼働させます。

1. **デプロイパッケージ（ZIP）の作成**
   手元のMacで以下のコマンドを実行し、ファイル一式をZIPにまとめます。
   ```bash
   cd server
   # プロダクション用の依存パッケージのみインストール
   npm ci --omit=dev
   # ソースコードをZIP圧縮（不要なファイルを除外）
   zip -r ../deploy-backend.zip . -x "*.git*" "*test*"
   cd ..
   ```

2. **Lambda 関数の作成**
   - AWSコンソールから「一から作成」を選択し、関数名（`epm-backend`等）、ランタイム（`Node.js 20.x`等）、アーキテクチャ（`arm64`推奨）を指定して作成。
   - **コードソース** の「アップロード元 > .zip ファイル」を選択し、先ほど作成した `deploy-backend.zip` をアップロードします。

3. **Lambda Layer（Web Adapter）の追加**
   - Lambda関数の画面の一番下にある「レイヤー」カテゴリから「レイヤーの追加」をクリック。
   - **「ARN を指定」** を選択し、以下のARNを入力して追加します（例は東京リージョン ap-northeast-1 / arm64 の場合）。
     - `arn:aws:lambda:ap-northeast-1:753240598075:layer:LambdaAdapterLayerArm64:24`
     - ※ x86アーキテクチャを選んだ場合は `arn:aws:lambda:ap-northeast-1:753240598075:layer:LambdaAdapterLayerX86:24` です。

4. **Lambda の設定**
   - **一般設定**: 
     - ハンドラの設定を `run.sh` などのカスタム起動コマンドにする**必要はありません**（Node.jsランタイムのままでLayerが通信をフックします）。
     - ただし環境変数 `AWS_LAMBDA_EXEC_WRAPPER` に `/opt/bootstrap` を設定します。
   - **VPC / ファイルシステム**: 
     - EFSを作成したVPC・サブネットを指定。
     - 作成したEFSアクセスポイントを設定（ローカルマウントパス: `/mnt/efs`）。
   - **環境変数**:
     - `AWS_LAMBDA_EXEC_WRAPPER` = `/opt/bootstrap`  ← **必須** (Web Adapterを有効化)
     - `PORT` = `8080` (AWS Lambda Web Adapterのデフォルト受け口ポート)
     - `DB_PATH` = `/mnt/efs/database.sqlite`
     - `UPLOAD_DIR` = `/mnt/efs/uploads`
   - **実行ロール**: EFSアクセス権限(`AmazonElasticFileSystemClientFullAccess`等)とVPCアクセス権限(`AWSLambdaVPCAccessExecutionRole`)を追加。

5. **Lambda 関数 URL の有効化**
   - API Gatewayは使わず、関数URLを「NONE (認証なし)」でパブリックに有効化し、CORSを許可しておくと素早くAPIが稼働します。

---

## 3. フロントエンド（SPA）のホスティング（S3 + CloudFront）

**目的**: ViteベースのVueアプリをビルドしてCDN経由で世界中に高速・セキュアに配信します。

1. **環境変数の用意**
   - `client/.env.production` を作成し、先ほどのLambda関数URLを向くように設定します。
     ```text
     VITE_API_BASE_URL=https://<あなたのLambda関数URLID>.lambda-url.ap-northeast-1.on.aws/api
     ```
2. **ビルド**
   - `npm run build --prefix client`
3. **S3バケットの作成とアップロード**
   - `epm-frontend-hosting` 等の名前でバケットを作成。
   - `client/dist` ディレクトリの中身をS3バケットのルートへアップロード。
4. **CloudFront の設定**
   - Originとして作成したS3バケットを指定し、Origin Access Control (OAC) を有効化します。
   - ※ OAC設定後、提示されるバケットポリシーをS3側に適用するのを忘れないようにしてください。
   - エラーページ設定で、HTTP 403 / 404 エラー発生時に `/index.html` (HTTP 200) を返すように設定すると、SPAのページルーティングが正常に動作します。

---

## 4. Basic認証の設定 (オプション)

**目的**: 全体がパブリックにならないよう、CloudFrontにBasic認証をかけます。

1. **CloudFront KeyValueStoreの作成**
2. **ユーザーとパスワードの登録**
   - ローカル（Mac）で以下のコマンドを実行し、ハッシュ値を取得します。
     ```bash
     npm run aws-auth あなたの使いたいID パスワード
     ```
   - マネジメントコンソールから、KeyValueStoreに「Key: ID」「Value: 取得したハッシュ値」を登録します。
3. **CloudFront Functions の作成**
   - Request（ビューワーリクエスト）でトリガーされる関数を作成し、発行済みのKeyValueStoreと紐づけ、Authorizationヘッダを検証するコードを記述してデプロイします。
   - これにより、アプリケーションアクセス時のID/PW保護が完了します。
