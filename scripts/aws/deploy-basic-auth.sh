#!/bin/bash
set -e

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=$(aws configure get region 2>/dev/null || echo "ap-northeast-1")
CF_COMMENT="EPM Application CF"

echo "======================================"
echo " EPM Basic Auth デプロイ"
echo " Account: $ACCOUNT_ID / Region: $REGION"
echo "======================================"

if [ -z "$BASIC_AUTH_USER" ] || [ -z "$BASIC_AUTH_PASS" ]; then
    echo "エラー: BASIC_AUTH_USER と BASIC_AUTH_PASS を環境変数として指定してください。"
    echo "例: BASIC_AUTH_USER=admin BASIC_AUTH_PASS=secret bash scripts/aws/deploy-basic-auth.sh"
    exit 1
fi

KVS_NAME="epm-basic-auth-kvs"
FUNC_NAME="epm-basic-auth-func"

# 1. KVS の作成/取得
echo "-> KeyValueStore の確認: $KVS_NAME"
KVS_ARN=$(aws cloudfront describe-key-value-store --name $KVS_NAME --query "KeyValueStore.ARN" --output text 2>/dev/null || true)

if [ -z "$KVS_ARN" ] || [ "$KVS_ARN" == "None" ]; then
    echo "-> 新規作成: $KVS_NAME"
    KVS_RES=$(aws cloudfront create-key-value-store --name $KVS_NAME --comment "For EPM Basic Auth")
    KVS_ARN=$(echo $KVS_RES | jq -r '.KeyValueStore.ARN')
else
    echo "-> 既存を使用: $KVS_ARN"
fi

# 2. データ操作用の ETag を取得
KVS_DATA=$(aws cloudfront-keyvaluestore describe-key-value-store --kvs-arn "$KVS_ARN")
KVS_ETAG=$(echo $KVS_DATA | jq -r '.ETag')

# 3. ハッシュ化とKVSへの登録
HASH=$(node scripts/aws-auth.js "$BASIC_AUTH_USER" "$BASIC_AUTH_PASS" | grep "値 (Value)" | awk -F': ' '{print $2}' | tr -d ' ')
echo "-> パスワードハッシュ登録: ユーザー $BASIC_AUTH_USER"

aws cloudfront-keyvaluestore put-key \
    --kvs-arn "$KVS_ARN" \
    --if-match "$KVS_ETAG" \
    --key "$BASIC_AUTH_USER" \
    --value "$HASH" > /dev/null
echo "-> 登録完了"

# 4. CloudFront Function の作成/更新
echo "-> CloudFront Function の確認: $FUNC_NAME"
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
    echo "-> 関数を新規作成"
    aws cloudfront create-function \
        --name $FUNC_NAME \
        --function-config file:///tmp/cf-func-config.json \
        --function-code fileb://scripts/aws/cloudfront-basic-auth.js > /dev/null
else
    echo "-> 関数を更新"
    DESCRIBE_FUNC=$(aws cloudfront describe-function --name $FUNC_NAME)
    FUNC_ETAG=$(echo $DESCRIBE_FUNC | jq -r '.ETag')
    aws cloudfront update-function \
        --name $FUNC_NAME \
        --if-match $FUNC_ETAG \
        --function-config file:///tmp/cf-func-config.json \
        --function-code fileb://scripts/aws/cloudfront-basic-auth.js > /dev/null
fi
rm -f /tmp/cf-func-config.json

# 関数のPublish
echo "-> 関数をPublish"
DESCRIBE_FUNC=$(aws cloudfront describe-function --name $FUNC_NAME)
FUNC_ETAG=$(echo $DESCRIBE_FUNC | jq -r '.ETag')
PUBLISH_RES=$(aws cloudfront publish-function --name $FUNC_NAME --if-match $FUNC_ETAG)
FUNC_ARN=$(echo $PUBLISH_RES | jq -r '.FunctionSummary.FunctionMetadata.FunctionARN')
echo "-> Basic Auth Function 準備完了 ($FUNC_ARN)"

# 5. CloudFront ディストリビューションに関連付け
echo "-> CloudFront ディストリビューションに紐付け中..."
DIST_ID=$(aws cloudfront list-distributions \
    --query "DistributionList.Items[?Comment=='$CF_COMMENT'].Id" --output text)

if [ -z "$DIST_ID" ] || [ "$DIST_ID" == "None" ]; then
    echo "エラー: CloudFront ディストリビューションが見つかりません。先に deploy-frontend.sh を実行してください。"
    exit 1
fi

aws cloudfront get-distribution-config --id $DIST_ID > /tmp/cf-cur-auth.json
DIST_ETAG=$(jq -r '.ETag' /tmp/cf-cur-auth.json)

FUNC_ASSOC='{"Quantity": 1, "Items": [{"FunctionARN": "'$FUNC_ARN'", "EventType": "viewer-request"}]}'

jq '.DistributionConfig' /tmp/cf-cur-auth.json \
  | jq --argjson funcAssoc "$FUNC_ASSOC" \
    '(.DefaultCacheBehavior.FunctionAssociations) = $funcAssoc
     | if .CacheBehaviors.Items then
         .CacheBehaviors.Items |= map(.FunctionAssociations = $funcAssoc)
       else . end' \
  > /tmp/cf-upd-auth.json

aws cloudfront update-distribution \
    --id $DIST_ID \
    --distribution-config file:///tmp/cf-upd-auth.json \
    --if-match $DIST_ETAG > /dev/null

rm -f /tmp/cf-cur-auth.json /tmp/cf-upd-auth.json

echo "=================================================="
echo "✅ Basic Auth デプロイ・紐付け完了！"
echo "※ CloudFront への反映(Deploying)が数分かかります"
echo "=================================================="
