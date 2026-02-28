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
   手元のMacで以下のコマンドを実行します。
   ```bash
   ./scripts/aws/deploy.sh
   ```
   スクリプトは以下を自動化します。
   - **ネイティブモジュールのクロスインストール**: `sharp` や `sqlite3` を Lambda (Linux ARM64) 環境で動作させるため、`npm_config_platform=linux` などの環境変数を指定してインストールをリビルドします。
   - Lambda 関数の作成または更新（メモリは **512MB** に最適化済み）
   - Lambda Layer（Web Adapter）のアタッチ
   - VPC・ EFS・環境変数の設定

2. **Lambda 関数の設定**
   - **アーキテクチャ**: `arm64`
   - **ランタイム**: `Node.js 20.x`
   - **ハンドラ**: `run.sh`（Lambda Web Adapter用）
   - **層（Layer）**: `arn:aws:lambda:ap-northeast-1:753240598075:layer:LambdaAdapterLayerArm64:22`
   - **必須環境変数**:
     - `AWS_LAMBDA_EXEC_WRAPPER` = `/opt/bootstrap`
     - `PORT` = `8080`
     - `DB_PATH` = `/mnt/efs/database.sqlite`
     - `UPLOAD_DIR` = `/mnt/efs/uploads`
   - **トリガー**: Lambda Function URL は**使用しません**。API Gateway HTTP APIから呼び出されます。

> **注意**: AWS Organizations の SCP（サービスコントロールポリシー）により、Lambda Function URL への直接 HTTP アクセスはブロックされます。そのため、バックエンドエンドポイントには **API Gateway HTTP API** を採用しています。

## 3. API Gateway HTTP API の構築

**目的**: CloudFrontからLambdaへのルーティングを API Gateway 経由で安定させます。

> **重要**: AWS Organizations の SCP により、Lambda Function URL への直接 HTTP アクセスがブロックされるため、**API Gateway HTTP API** をバックエンドのエントリポイントとし〆6ます。

```bash
# デプロイスクリプトで自動実行されます。手動で行う場合のコマンド例:

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
LAMBDA_ARN="arn:aws:lambda:ap-northeast-1:${ACCOUNT_ID}:function:epm-backend"

# API Gateway HTTP API を作成
 aws apigatewayv2 create-api \
    --name epm-api \
    --protocol-type HTTP \
    --target $LAMBDA_ARN \
    --cors-configuration AllowOrigins='["*"]',AllowMethods='["GET","POST","PUT","DELETE","PATCH","OPTIONS"]',AllowHeaders='["*"]'

# Lambda 呼び出し権限付与
aws lambda add-permission \
    --function-name epm-backend \
    --statement-id AllowAPIGatewayInvoke \
    --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:ap-northeast-1:${ACCOUNT_ID}:<API_ID>/*/*"
```

---

## 4. フロントエンド（SPA）のホスティング（S3 + CloudFront）

**目的**: ViteベースのVueアプリをビルドしてCDN経由で世界中に高速・セキュアに配信します。

1. **デプロイスクリプトで一括実行**
   以下の **1コマンド** で、ビルドからS3アップロード、CloudFront構築、キャッシュ削除まで全自動化されます。
   ```bash
   ./scripts/aws/deploy-frontend.sh
   ```
   スクリプトは以下を自動実行します。
   1. API Gateway URLの取得
   2. S3バケットの作成（未作成の場合）
   3. CloudFront S3 OACの作成（未作成の場合）
   4. CloudFrontディストリビューションの作成（未作成の場合）または API Gatewayドメインの更新
   5. S3バケットポリシーの適用（CloudFront OACのみアクセス容認）
   6. `VITE_API_BASE_URL=https://<CloudFrontドメイン>/api` でViteフロントエンドをビルドしS3にアップロード
   7. CloudFrontキャッシュ削除

   > **重要**: `VITE_API_BASE_URL` を Lambda の Function URL ではなく、**CloudFrontの URL** (`https://<CFドメイン>/api`) に設定すること。これにより、全てのリクエストが CloudFront 経由となり SCP 制約を回避できます。

4. **CloudFront のルーティング構成**
   ```
   https://<CloudFrontドメイン>
     ├── /api/*  → API Gateway HTTP API → Lambda (Express)
     └── /*      → S3 (index.html, 静的アセット)
   ```
   - S3の403/404 → `index.html` (HTTP 200) にリダイレクト（SPAルーティング用）
   - APIリクエストはキャッシュ無効（MinTTL=0, DefaultTTL=0）

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
