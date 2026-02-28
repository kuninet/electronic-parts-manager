# AWS サーバーレス インフラ構築・デプロイ手順

このドキュメントでは、電子パーツ管理アプリをAWS環境（サーバーレス環境）に構築し、デプロイするための具体的な手順を解説します。

## 0. 事前準備
1. **AWS CLIの設定**
   - `aws configure` コマンドで対象AWSアカウントのアクセス情報を設定済みであること。
2. **Dockerの設定**
   - バックエンドのコンテナビルドを行うため、手元のMacにDocker Desktop等のコンテナ環境がインストールされていること。

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
     - *権限*: `0777` （Lambdaコンテナから書き込めるように適宜緩めにしておきます）
     - *パス*: `/`

---

## 2. バックエンド層（AWS Lambda + ECR）のデプロイ

**目的**: Expressで作られた既存のAPIを、コンテナ化してAWS Lambda上で稼働させます。

1. **Amazon ECR リポジトリの作成**
   - `epm-backend` という名前でプライベートリポジトリを作成します。
2. **イメージのビルドとPush（手元のMacで実行）**
   ```bash
   # ECRへログイン (ACCOUNT_ID と REGION をご自身のものに置き換えてください)
   aws ecr get-login-password --region ap-northeast-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com
   
   # ビルド (Apple Silicon Macの場合は --platform linux/arm64 などを指定してアーキテクチャを合わせる)
   docker build --platform linux/arm64 -t epm-backend ./server
   
   # タグ付けとPush
   docker tag epm-backend:latest <ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com/epm-backend:latest
   docker push <ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com/epm-backend:latest
   ```
3. **Lambda 関数の作成**
   - 「コンテナイメージ」から関数を作成し、先ほどPushしたイメージとアーキテクチャ(arm64等)を選択します。
4. **Lambda の設定**
   - **VPC**: EFSを作成したVPC・サブネットを指定。
   - **ファイルシステム**: 作成したEFSアクセスポイントを設定（ローカルマウントパス: `/mnt/efs`）。
   - **環境変数**:
     - `DB_PATH` = `/mnt/efs/database.sqlite`
     - `UPLOAD_DIR` = `/mnt/efs/uploads`
     - `PORT` = `3000` (または3001)
   - **実行ロール**: EFSアクセス権限(`AmazonElasticFileSystemClientFullAccess`等)とVPCアクセス権限(`AWSLambdaVPCAccessExecutionRole`)を追加。
5. **Lambda 関数 URL の有効化**
   - API Gatewayは使わず、関数URLを「NONE (認証なし)」でパブリックに有効化し、CORSを許可しておくと素早くAPIが稼働します。（CloudFront経由に限定する場合はIAM認証をかけることも可能です）

---

## 3. フロントエンド（SPA）のホスティング（S3 + CloudFront）

**目的**: ViteベースのVueアプリをビルドしてCDN経由で世界中に高速・セキュアに配信します。

1. **環境変数の用意**
   - `client/.env.production` などのファイルを作成し、先ほどのLambda関数URLを向くように設定します（任意）。
     ```text
     VITE_API_BASE_URL=https://<あなたのLambda関数URLID>.lambda-url.ap-northeast-1.on.aws/api
     ```
   - ※ CloudFrontで `/api` をLambda関数URLに直接ルーティングする構成にする場合は、この設定は不要です。
2. **ビルド**
   - `npm run build --prefix client`
3. **S3バケットの作成とアップロード**
   - `epm-frontend-hosting` 等の名前でバケットを作成（パブリックアクセスはすべてブロックのままでOK）。
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
