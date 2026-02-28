#!/bin/bash
# EFS上の既存画像をS3に移行するスクリプト
# LambdaのEFSマウント環境内またはEC2/Cloud9から実行
set -e

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
IMAGES_BUCKET="epm-images-$ACCOUNT_ID"
EFS_UPLOADS="/mnt/efs/uploads"

echo "=== EFS → S3 画像移行スクリプト ==="
echo "移行元: $EFS_UPLOADS"
echo "移行先: s3://$IMAGES_BUCKET/uploads/"
echo ""

if [ ! -d "$EFS_UPLOADS" ]; then
    echo "ERROR: $EFS_UPLOADS が見つかりません"
    exit 1
fi

# S3に同期（import_temp.zipは除外）
echo "S3へ同期中..."
aws s3 sync "$EFS_UPLOADS/" "s3://$IMAGES_BUCKET/uploads/" --exclude "import_temp.zip"

echo ""
echo "同期完了。S3の内容を確認してください:"
aws s3 ls "s3://$IMAGES_BUCKET/uploads/" | head -20

echo ""
read -p "EFS上の画像ファイルを削除しますか？ (yes/no): " CONFIRM
if [ "$CONFIRM" = "yes" ]; then
    echo "EFSのuploads内ファイルを削除中..."
    find "$EFS_UPLOADS" -type f ! -name ".gitkeep" -delete
    echo "削除完了"
else
    echo "削除をスキップしました"
fi

echo ""
echo "=== 移行完了 ==="
