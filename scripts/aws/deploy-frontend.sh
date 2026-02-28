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
# [3.8/7] Basic Auth 用 KeyValueStore & Function の構築
# ==========================================
BASIC_AUTH_ENABLED=false
FUNC_ARN=""

if [ -n "$BASIC_AUTH_USER" ] && [ -n "$BASIC_AUTH_PASS" ]; then
    echo ""
    echo "[3.8/7] Basic Auth 用 KeyValueStore & Function の構築..."
    KVS_NAME="epm-basic-auth-kvs"
    FUNC_NAME="epm-basic-auth-func"
    
    # 1. KVS の作成/取得
    echo "  -> KeyValueStore の確認: $KVS_NAME"
    KVS_ARN=$(aws cloudfront describe-key-value-store --name $KVS_NAME --query "KeyValueStore.ARN" --output text 2>/dev/null || true)
    
    if [ -z "$KVS_ARN" ] || [ "$KVS_ARN" == "None" ]; then
        echo "  -> 新規作成: $KVS_NAME"
        KVS_RES=$(aws cloudfront create-key-value-store --name $KVS_NAME --comment "For EPM Basic Auth")
        KVS_ARN=$(echo $KVS_RES | jq -r '.KeyValueStore.ARN')
    else
        echo "  -> 既存を使用: $KVS_ARN"
    fi
    
    # 2. データ操作用の ETag を取得 (cloudfront-keyvaluestore ネームスペースを使用)
    KVS_DATA=$(aws cloudfront-keyvaluestore describe-key-value-store --kvs-arn "$KVS_ARN")
    KVS_ETAG=$(echo $KVS_DATA | jq -r '.ETag')
    
    # 3. ハッシュ化とKVSへの登録
    HASH=$(node scripts/aws-auth.js "$BASIC_AUTH_USER" "$BASIC_AUTH_PASS" | grep "値 (Value)" | awk -F': ' '{print $2}' | tr -d ' ')
    echo "  -> パスワードハッシュ登録: ユーザー $BASIC_AUTH_USER"
    
    aws cloudfront-keyvaluestore put-key \
        --kvs-arn "$KVS_ARN" \
        --if-match "$KVS_ETAG" \
        --key "$BASIC_AUTH_USER" \
        --value "$HASH" > /dev/null
    echo "  -> 登録完了"
    
    # 3. CloudFront Function の作成/更新
    echo "  -> CloudFront Function の確認: $FUNC_NAME"
    FUNC_EXISTS=$(aws cloudfront describe-function --name $FUNC_NAME --query "FunctionSummary.Name" --output text 2>/dev/null || true)
    
    cat <<FUNC_CONF > /tmp/cf-func-config.json
{
    "Comment": "EPM Basic Auth",
    "Runtime": "cloudfront-js-2.0",
    "KeyValueStoreAssociations": {
        "Quantity": 1,
        "Items": [
            { "KeyValueStoreARN": "$KVS_ARN" }
        ]
    }
}
FUNC_CONF

    if [ -z "$FUNC_EXISTS" ] || [ "$FUNC_EXISTS" == "None" ]; then
        echo "  -> 関数を新規作成"
        aws cloudfront create-function \
            --name $FUNC_NAME \
            --function-config file:///tmp/cf-func-config.json \
            --function-code fileb://scripts/aws/cloudfront-basic-auth.js > /dev/null
    else
        echo "  -> 関数を更新"
        DESCRIBE_FUNC=$(aws cloudfront describe-function --name $FUNC_NAME)
        FUNC_ETAG=$(echo $DESCRIBE_FUNC | jq -r '.ETag')
        aws cloudfront update-function \
            --name $FUNC_NAME \
            --if-match $FUNC_ETAG \
            --function-config file:///tmp/cf-func-config.json \
            --function-code fileb://scripts/aws/cloudfront-basic-auth.js > /dev/null
    fi
    rm /tmp/cf-func-config.json

    # 関数のPublish
    echo "  -> 関数をPublish"
    DESCRIBE_FUNC=$(aws cloudfront describe-function --name $FUNC_NAME)
    FUNC_ETAG=$(echo $DESCRIBE_FUNC | jq -r '.ETag')
    PUBLISH_RES=$(aws cloudfront publish-function --name $FUNC_NAME --if-match $FUNC_ETAG)
    FUNC_ARN=$(echo $PUBLISH_RES | jq -r '.FunctionSummary.FunctionMetadata.FunctionARN')
    
    BASIC_AUTH_ENABLED=true
    echo "  -> Basic Auth 設定準備完了 ($FUNC_ARN)"
fi

# Function アソシエーション設定の生成
if [ "$BASIC_AUTH_ENABLED" = true ]; then
    FUNC_ASSOC='{"Quantity": 1, "Items": [{"FunctionARN": "'$FUNC_ARN'", "EventType": "viewer-request"}]}'
else
    FUNC_ASSOC='{"Quantity": 0, "Items": []}'
fi

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
        "FunctionAssociations": $FUNC_ASSOC,
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
                "FunctionAssociations": $FUNC_ASSOC,
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
                "FunctionAssociations": $FUNC_ASSOC,
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
           --argjson funcAssoc "$FUNC_ASSOC" \
           --arg imagesDomain "$IMAGES_S3_DOMAIN" \
           --arg imagesOacId "$IMAGES_OAC_ID" \
        '(.DefaultCacheBehavior.FunctionAssociations) = $funcAssoc
         | (.Origins.Items[] | select(.Id == "Lambda-Backend") | .DomainName) = $domain
         | (.Origins.Items[] | select(.Id == "Lambda-Backend") | .OriginAccessControlId) = ""
         | if (.Origins.Items | map(.Id) | contains(["S3-Images"])) then . else
             .Origins.Quantity += 1
             | .Origins.Items += [{
                 "Id": "S3-Images",
                 "DomainName": $imagesDomain,
                 "OriginPath": "",
                 "OriginAccessControlId": $imagesOacId,
                 "S3OriginConfig": {"OriginAccessIdentity": ""},
                 "ConnectionAttempts": 3,
                 "ConnectionTimeout": 10,
                 "CustomHeaders": {"Quantity": 0, "Items": []}
               }]
           end
         | .CacheBehaviors.Quantity = 2
         | .CacheBehaviors.Items = [
             ((.CacheBehaviors.Items[] | select(.PathPattern == "/api/*"))
              | .FunctionAssociations = $funcAssoc),
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
              | .FunctionAssociations = $funcAssoc
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
