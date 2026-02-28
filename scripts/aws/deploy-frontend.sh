#!/bin/bash
set -e

# ==========================================
# デプロイメント設定
# ==========================================
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=$(aws configure get region 2>/dev/null || echo "ap-northeast-1")
BUCKET_NAME="epm-frontend-${ACCOUNT_ID}"
LAMBDA_NAME="epm-backend"
LAMBDA_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${LAMBDA_NAME}"
API_NAME="epm-api"
CF_COMMENT="EPM Application CF"

echo "======================================"
echo " EPM フロントエンド デプロイ"
echo " Account: $ACCOUNT_ID / Region: $REGION"
echo "======================================"

# ==========================================
# 1. API Gateway HTTP API の作成 or 取得
# ==========================================
echo ""
echo "[1/7] API Gateway の確認..."
API_ID=$(aws apigatewayv2 get-apis --query "Items[?Name=='$API_NAME'].ApiId" --output text)

if [ -z "$API_ID" ] || [ "$API_ID" == "None" ]; then
    echo "  -> 新規作成: $API_NAME"
    API_ID=$(aws apigatewayv2 create-api \
        --name $API_NAME \
        --protocol-type HTTP \
        --target $LAMBDA_ARN \
        --cors-configuration AllowOrigins='["*"]',AllowMethods='["GET","POST","PUT","DELETE","PATCH","OPTIONS"]',AllowHeaders='["*"]' \
        --query 'ApiId' --output text)

    # Lambda 呼び出し権限付与（重複エラーは無視）
    aws lambda add-permission \
        --function-name $LAMBDA_NAME \
        --statement-id AllowAPIGatewayInvoke \
        --action lambda:InvokeFunction \
        --principal apigateway.amazonaws.com \
        --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT_ID}:${API_ID}/*/*" \
        --output text 2>/dev/null || true
else
    echo "  -> 既存を使用: $API_ID"
fi

APIGW_DOMAIN="${API_ID}.execute-api.${REGION}.amazonaws.com"
echo "  API Gateway: https://$APIGW_DOMAIN/"

# ==========================================
# 2. S3 バケットの作成
# ==========================================
echo ""
echo "[2/7] S3 バケットの確認..."
S3_DOMAIN="${BUCKET_NAME}.s3.${REGION}.amazonaws.com"

if ! aws s3api head-bucket --bucket "$BUCKET_NAME" 2>/dev/null; then
    echo "  -> 新規作成: $BUCKET_NAME"
    if [ "$REGION" == "us-east-1" ]; then
        aws s3api create-bucket --bucket $BUCKET_NAME > /dev/null
    else
        aws s3api create-bucket --bucket $BUCKET_NAME \
            --create-bucket-configuration LocationConstraint=$REGION > /dev/null
    fi
    aws s3api put-public-access-block \
        --bucket $BUCKET_NAME \
        --public-access-block-configuration \
        "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
else
    echo "  -> 既存を使用: $BUCKET_NAME"
fi

# ==========================================
# 3. CloudFront S3 OAC の作成 or 取得
# ==========================================
echo ""
echo "[3/7] CloudFront OAC の確認..."
S3_OAC_NAME="epm-s3-oac"

S3_OAC_ID=$(aws cloudfront list-origin-access-controls \
    --query "OriginAccessControlList.Items[?Name=='$S3_OAC_NAME'].Id" --output text)
if [ -z "$S3_OAC_ID" ] || [ "$S3_OAC_ID" == "None" ]; then
    echo "  -> 新規作成: $S3_OAC_NAME"
    S3_OAC_ID=$(aws cloudfront create-origin-access-control \
        --origin-access-control-config \
        "Name=$S3_OAC_NAME,Description=OAC for EPM Frontend S3,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" \
        --query 'OriginAccessControl.Id' --output text)
else
    echo "  -> 既存を使用: $S3_OAC_ID"
fi

# ==========================================
# [3.5/7] S3 Images バケットのOAC作成/取得
# ==========================================
echo ""
echo "[3.5/7] S3 Images OAC の確認..."
IMAGES_BUCKET_NAME="epm-images-${ACCOUNT_ID}"
IMAGES_OAC_NAME="epm-images-oac"

IMAGES_OAC_ID=$(aws cloudfront list-origin-access-controls \
    --query "OriginAccessControlList.Items[?Name=='$IMAGES_OAC_NAME'].Id" --output text)
if [ -z "$IMAGES_OAC_ID" ] || [ "$IMAGES_OAC_ID" == "None" ]; then
    echo "  -> 新規作成: $IMAGES_OAC_NAME"
    IMAGES_OAC_ID=$(aws cloudfront create-origin-access-control \
        --origin-access-control-config \
        "Name=$IMAGES_OAC_NAME,Description=OAC for EPM Images S3,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" \
        --query 'OriginAccessControl.Id' --output text)
else
    echo "  -> 既存を使用: $IMAGES_OAC_ID"
fi
IMAGES_S3_DOMAIN="${IMAGES_BUCKET_NAME}.s3.${REGION}.amazonaws.com"

# ==========================================
# 4. CloudFront ディストリビューションの作成 or 更新
# ==========================================
echo ""
echo "[4/7] CloudFront ディストリビューションの確認..."
DIST_ID=$(aws cloudfront list-distributions \
    --query "DistributionList.Items[?Comment=='$CF_COMMENT'].Id" --output text)

if [ -z "$DIST_ID" ] || [ "$DIST_ID" == "None" ]; then
    echo "  -> 新規作成..."
    cat <<EOF > /tmp/cf-config.json
{
    "CallerReference": "$(date +%s)",
    "Comment": "$CF_COMMENT",
    "Enabled": true,
    "DefaultRootObject": "index.html",
    "Origins": {
        "Quantity": 3,
        "Items": [
            {
                "Id": "S3-Frontend",
                "DomainName": "$S3_DOMAIN",
                "OriginAccessControlId": "$S3_OAC_ID",
                "S3OriginConfig": { "OriginAccessIdentity": "" }
            },
            {
                "Id": "Lambda-Backend",
                "DomainName": "$APIGW_DOMAIN",
                "CustomOriginConfig": {
                    "HTTPPort": 80,
                    "HTTPSPort": 443,
                    "OriginProtocolPolicy": "https-only",
                    "OriginSslProtocols": { "Quantity": 1, "Items": ["TLSv1.2"] }
                }
            },
            {
                "Id": "S3-Images",
                "DomainName": "$IMAGES_S3_DOMAIN",
                "OriginAccessControlId": "$IMAGES_OAC_ID",
                "S3OriginConfig": { "OriginAccessIdentity": "" }
            }
        ]
    },
    "DefaultCacheBehavior": {
        "TargetOriginId": "S3-Frontend",
        "ViewerProtocolPolicy": "redirect-to-https",
        "AllowedMethods": {
            "Quantity": 2,
            "Items": ["GET", "HEAD"],
            "CachedMethods": { "Quantity": 2, "Items": ["GET", "HEAD"] }
        },
        "Compress": true,
        "ForwardedValues": {
            "QueryString": false,
            "Cookies": { "Forward": "none" }
        },
        "MinTTL": 0,
        "DefaultTTL": 86400,
        "MaxTTL": 31536000
    },
    "CacheBehaviors": {
        "Quantity": 2,
        "Items": [
            {
                "PathPattern": "/api/*",
                "TargetOriginId": "Lambda-Backend",
                "ViewerProtocolPolicy": "https-only",
                "AllowedMethods": {
                    "Quantity": 7,
                    "Items": ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]
                },
                "ForwardedValues": {
                    "QueryString": true,
                    "Cookies": { "Forward": "all" },
                    "Headers": { "Quantity": 1, "Items": ["Authorization"] }
                },
                "MinTTL": 0,
                "DefaultTTL": 0,
                "MaxTTL": 0
            },
            {
                "PathPattern": "/uploads/*",
                "TargetOriginId": "S3-Images",
                "ViewerProtocolPolicy": "https-only",
                "AllowedMethods": {
                    "Quantity": 2,
                    "Items": ["GET", "HEAD"]
                },
                "Compress": true,
                "ForwardedValues": {
                    "QueryString": false,
                    "Cookies": { "Forward": "none" },
                    "Headers": { "Quantity": 0, "Items": [] }
                },
                "MinTTL": 0,
                "DefaultTTL": 86400,
                "MaxTTL": 31536000
            }
        ]
    },
    "CustomErrorResponses": {
        "Quantity": 2,
        "Items": [
            {
                "ErrorCode": 403,
                "ResponsePagePath": "/index.html",
                "ResponseCode": "200",
                "ErrorCachingMinTTL": 10
            },
            {
                "ErrorCode": 404,
                "ResponsePagePath": "/index.html",
                "ResponseCode": "200",
                "ErrorCachingMinTTL": 10
            }
        ]
    },
    "ViewerCertificate": { "CloudFrontDefaultCertificate": true }
}
EOF
    DIST_RESULT=$(aws cloudfront create-distribution --distribution-config file:///tmp/cf-config.json)
    DIST_ID=$(echo $DIST_RESULT | jq -r '.Distribution.Id')
    DIST_DOMAIN=$(echo $DIST_RESULT | jq -r '.Distribution.DomainName')
    DIST_ARN=$(echo $DIST_RESULT | jq -r '.Distribution.ARN')
    rm /tmp/cf-config.json
    echo "  -> 作成完了: https://$DIST_DOMAIN"
else
    echo "  -> 既存を使用: $DIST_ID"
    DIST_DATA=$(aws cloudfront get-distribution --id $DIST_ID)
    DIST_DOMAIN=$(echo $DIST_DATA | jq -r '.Distribution.DomainName')
    DIST_ARN=$(echo $DIST_DATA | jq -r '.Distribution.ARN')

    # API Gatewayドメインを更新する
    aws cloudfront get-distribution-config --id $DIST_ID > /tmp/cf-cur.json
    ETAG=$(jq -r '.ETag' /tmp/cf-cur.json)

    # /api/* ビヘイビアをベースに /uploads/* ビヘイビアを作成し、キャッシュ設定を最適化
    jq '.DistributionConfig' /tmp/cf-cur.json \
      | jq --arg domain "$APIGW_DOMAIN" \
           --arg imagesDomain "$IMAGES_S3_DOMAIN" \
           --arg imagesOacId "$IMAGES_OAC_ID" \
        '(.Origins.Items[] | select(.Id == "Lambda-Backend") | .DomainName) = $domain
         | (.Origins.Items[] | select(.Id == "Lambda-Backend") | .OriginAccessControlId) = ""
         | if (.Origins.Items | map(.Id) | contains(["S3-Images"])) then . else
             .Origins.Quantity += 1
             | .Origins.Items += [{
                 "Id": "S3-Images",
                 "DomainName": $imagesDomain,
                 "OriginAccessControlId": $imagesOacId,
                 "S3OriginConfig": {"OriginAccessIdentity": ""},
                 "ConnectionAttempts": 3,
                 "ConnectionTimeout": 10,
                 "CustomHeaders": {"Quantity": 0, "Items": []}
               }]
           end
         | .CacheBehaviors.Quantity = 2
         | .CacheBehaviors.Items = [
             (.CacheBehaviors.Items[] | select(.PathPattern == "/api/*")),
             ((.CacheBehaviors.Items[] | select(.PathPattern == "/api/*"))
              | .PathPattern = "/uploads/*"
              | .TargetOriginId = "S3-Images"
              | .Compress = true
              | .DefaultTTL = 86400
              | .MaxTTL = 31536000
              | .ForwardedValues.QueryString = false
              | .ForwardedValues.Cookies.Forward = "none"
              | .ForwardedValues.Headers = {"Quantity": 0, "Items": []}
              | .AllowedMethods = {"Quantity": 2, "Items": ["GET", "HEAD"], "CachedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"]}}
             )
           ]
         | .CustomErrorResponses = {"Quantity": 2, "Items": [{"ErrorCode": 403, "ResponsePagePath": "/index.html", "ResponseCode": "200", "ErrorCachingMinTTL": 10}, {"ErrorCode": 404, "ResponsePagePath": "/index.html", "ResponseCode": "200", "ErrorCachingMinTTL": 10}]}' \
      > /tmp/cf-upd.json

    aws cloudfront update-distribution \
        --id $DIST_ID \
        --distribution-config file:///tmp/cf-upd.json \
        --if-match $ETAG > /dev/null
    echo "  -> CloudFrontの設定を更新完了"
fi

echo "  CloudFront URL: https://$DIST_DOMAIN"

# ==========================================
# 5. S3 バケットポリシー（CloudFrontからのみ読み取り許可）
# ==========================================
echo ""
echo "[5/7] S3 バケットポリシーを設定..."
cat <<EOF > /tmp/s3-policy.json
{
    "Version": "2012-10-17",
    "Statement": {
        "Sid": "AllowCloudFrontServicePrincipalReadOnly",
        "Effect": "Allow",
        "Principal": { "Service": "cloudfront.amazonaws.com" },
        "Action": "s3:GetObject",
        "Resource": "arn:aws:s3:::$BUCKET_NAME/*",
        "Condition": {
            "StringEquals": { "AWS:SourceArn": "$DIST_ARN" }
        }
    }
}
EOF
aws s3api put-bucket-policy --bucket $BUCKET_NAME --policy file:///tmp/s3-policy.json
rm /tmp/s3-policy.json
echo "  -> 設定完了"

# S3 Images バケットポリシー（CloudFrontからのGetObjectのみ許可）
cat <<EOF > /tmp/s3-images-policy.json
{
    "Version": "2012-10-17",
    "Statement": {
        "Sid": "AllowCloudFrontServicePrincipalReadOnly",
        "Effect": "Allow",
        "Principal": { "Service": "cloudfront.amazonaws.com" },
        "Action": "s3:GetObject",
        "Resource": "arn:aws:s3:::$IMAGES_BUCKET_NAME/*",
        "Condition": {
            "StringEquals": { "AWS:SourceArn": "$DIST_ARN" }
        }
    }
}
EOF
aws s3api put-bucket-policy --bucket $IMAGES_BUCKET_NAME --policy file:///tmp/s3-images-policy.json
rm /tmp/s3-images-policy.json
echo "  -> S3 Images バケットポリシー設定完了"

# ==========================================
# 6. フロントエンドをビルド（CloudFront URLで）
# ==========================================
echo ""
echo "[6/7] フロントエンドのビルド..."
echo "  VITE_API_BASE_URL=https://$DIST_DOMAIN/api"
echo "VITE_API_BASE_URL=https://$DIST_DOMAIN/api" > client/.env.production

cd client
npm ci --prefer-offline 2>/dev/null || npm ci
npm run build
cd ..

# S3 へアップロード
echo "  S3へアップロード中..."
aws s3 sync client/dist s3://$BUCKET_NAME/ --delete

# ==========================================
# 7. CloudFront キャッシュ削除
# ==========================================
echo ""
echo "[7/7] CloudFront キャッシュ削除..."
aws cloudfront create-invalidation --distribution-id $DIST_ID --paths "/*" > /dev/null
echo "  -> 削除リクエスト送信完了"

echo ""
echo "=================================================="
echo "✅ デプロイ完了！"
echo "🌐 CloudFront URL: https://$DIST_DOMAIN"
echo "🔌 API Gateway URL: https://$APIGW_DOMAIN"
echo "※ キャッシュ削除完了まで数分かかります。"
echo "=================================================="
