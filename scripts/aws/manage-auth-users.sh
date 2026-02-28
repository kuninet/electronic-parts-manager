#!/bin/bash
set -e

# Basic Auth ユーザー管理ツール
# 使い方: ./scripts/aws/manage-auth-users.sh <user> <pass>

if [ $# -lt 2 ]; then
    echo "使用方法: $0 <username> <password>"
    exit 1
fi

USER=$1
PASS=$2
KVS_NAME="epm-basic-auth-kvs"

# KVS ARN の取得
KVS_ARN=$(aws cloudfront describe-key-value-store --name $KVS_NAME --query "KeyValueStore.ARN" --output text 2>/dev/null || true)

if [ -z "$KVS_ARN" ] || [ "$KVS_ARN" == "None" ]; then
    echo "エラー: KeyValueStore '$KVS_NAME' が見つかりません。先にデプロイスクリプトを実行してください。"
    exit 1
fi

# 最新の ETag を取得
KVS_DATA=$(aws cloudfront-keyvaluestore describe-key-value-store --kvs-arn "$KVS_ARN")
KVS_ETAG=$(echo $KVS_DATA | jq -r '.ETag')

# パスワードハッシュの生成
HASH=$(node scripts/aws-auth.js "$USER" "$PASS" | grep "値 (Value)" | awk -F': ' '{print $2}' | tr -d ' ')

echo "ユーザー '$USER' を KeyValueStore に登録/更新中..."
aws cloudfront-keyvaluestore put-key \
    --kvs-arn "$KVS_ARN" \
    --if-match "$KVS_ETAG" \
    --key "$USER" \
    --value "$HASH" > /dev/null

echo "✅ 登録完了！"
