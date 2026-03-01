#!/bin/bash
# AWS Serverless Deployment Script for Electronic Parts Manager
# This script automates the creation of AWS resources using AWS CLI.

set -e

REGION="ap-northeast-1"
export AWS_DEFAULT_REGION=$REGION

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Deploying to AWS Account: $ACCOUNT_ID"

# 0. Configuration & Secrets (Issue #21)
ORIGIN_VERIFY_SECRET=$(aws ssm get-parameter --name "/epm/origin-verify-secret" --with-decryption --query "Parameter.Value" --output text 2>/dev/null || echo "")
if [ -z "$ORIGIN_VERIFY_SECRET" ]; then
    echo "Generating new ORIGIN_VERIFY_SECRET..."
    ORIGIN_VERIFY_SECRET=$(openssl rand -hex 16)
    aws ssm put-parameter --name "/epm/origin-verify-secret" --value "$ORIGIN_VERIFY_SECRET" --type "SecureString" --overwrite > /dev/null
fi

# 1. IAM Role for Lambda
ROLE_NAME="epm-lambda-execution-role"
echo "Checking IAM Role: $ROLE_NAME"
if ! aws iam get-role --role-name $ROLE_NAME > /dev/null 2>&1; then
    echo "Creating IAM Role..."
    aws iam create-role --role-name $ROLE_NAME \
        --assume-role-policy-document '{
            "Version": "2012-10-17",
            "Statement": [{ "Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole" }]
        }' > /dev/null
    
    # Attach necessary policies
    aws iam attach-role-policy --role-name $ROLE_NAME --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
    aws iam attach-role-policy --role-name $ROLE_NAME --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole
    aws iam attach-role-policy --role-name $ROLE_NAME --policy-arn arn:aws:iam::aws:policy/AmazonElasticFileSystemClientFullAccess
    
    echo "Waiting for role to propagate..."
    sleep 10
else
    echo "IAM Role already exists."
fi

ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"

# 1.1 S3 Upload Bucket and Policy
UPLOAD_BUCKET="epm-upload-$ACCOUNT_ID"
echo "Checking S3 Upload Bucket: $UPLOAD_BUCKET"
if ! aws s3api head-bucket --bucket $UPLOAD_BUCKET > /dev/null 2>&1; then
    echo "Creating S3 Upload Bucket..."
    aws s3api create-bucket --bucket $UPLOAD_BUCKET --region $REGION --create-bucket-configuration LocationConstraint=$REGION > /dev/null
    
    # Configure CORS
    aws s3api put-bucket-cors --bucket $UPLOAD_BUCKET --cors-configuration '{
        "CORSRules": [
            {
                "AllowedOrigins": ["*"],
                "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
                "AllowedHeaders": ["*"],
                "ExposeHeaders": ["ETag"]
            }
        ]
    }'
    
    # Configure Lifecycle (Auto-delete after 1 day)
    aws s3api put-bucket-lifecycle-configuration --bucket $UPLOAD_BUCKET --lifecycle-configuration '{
        "Rules": [
            {
                "ID": "DeleteOldImports",
                "Prefix": "imports/",
                "Status": "Enabled",
                "Expiration": { "Days": 1 }
            },
            {
                "ID": "DeleteOldExports",
                "Prefix": "exports/",
                "Status": "Enabled",
                "Expiration": { "Days": 1 }
            }
        ]
    }'
fi

echo "Ensuring S3 IAM Policy for Lambda..."
aws iam put-role-policy --role-name $ROLE_NAME --policy-name EPM-S3-Upload-Policy --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [
        {
            \"Effect\": \"Allow\",
            \"Action\": [\"s3:PutObject\", \"s3:GetObject\", \"s3:DeleteObject\", \"s3:ListBucket\"],
            \"Resource\": [\"arn:aws:s3:::$UPLOAD_BUCKET\", \"arn:aws:s3:::$UPLOAD_BUCKET/*\"]
        }
    ]
}"

# Lambda自己呼び出し用IAMインラインポリシー
echo "Ensuring Lambda self-invoke IAM Policy..."
aws iam put-role-policy --role-name $ROLE_NAME \
    --policy-name epm-lambda-invoke-self \
    --policy-document "{
        \"Version\": \"2012-10-17\",
        \"Statement\": [{
            \"Effect\": \"Allow\",
            \"Action\": [\"lambda:InvokeFunction\"],
            \"Resource\": \"arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:epm-backend\"
        }]
    }"

# 1.2 S3 Images Bucket and Policy
IMAGES_BUCKET="epm-images-$ACCOUNT_ID"
echo "Checking S3 Images Bucket: $IMAGES_BUCKET"
if ! aws s3api head-bucket --bucket $IMAGES_BUCKET > /dev/null 2>&1; then
    echo "Creating S3 Images Bucket..."
    aws s3api create-bucket --bucket $IMAGES_BUCKET --region $REGION --create-bucket-configuration LocationConstraint=$REGION > /dev/null
    aws s3api put-public-access-block \
        --bucket $IMAGES_BUCKET \
        --public-access-block-configuration \
        "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
else
    echo "S3 Images Bucket already exists."
fi

echo "Ensuring S3 IAM Policy for Images Bucket..."
aws iam put-role-policy --role-name $ROLE_NAME --policy-name EPM-S3-Images-Policy --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [
        {
            \"Effect\": \"Allow\",
            \"Action\": [\"s3:PutObject\", \"s3:GetObject\", \"s3:DeleteObject\", \"s3:ListBucket\"],
            \"Resource\": [\"arn:aws:s3:::$IMAGES_BUCKET\", \"arn:aws:s3:::$IMAGES_BUCKET/*\"]
        }
    ]
}"

# 2. Get Default VPC and Subnets
echo "Getting Default VPC details..."
VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
if [ "$VPC_ID" == "None" ]; then
    echo "Default VPC not found. Please create one or specify a VPC ID."
    exit 1
fi
echo "Using VPC: $VPC_ID"

SUBNET_IDS=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" --query 'Subnets[*].SubnetId' --output text)
SUBNET_ARRAY=($SUBNET_IDS)

# 3. Security Group for EFS & Lambda
SG_NAME="epm-serverless-sg"
SG_ID=$(aws ec2 describe-security-groups --filters Name=group-name,Values=$SG_NAME Name=vpc-id,Values=$VPC_ID --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo "None")

if [ "$SG_ID" == "None" ]; then
    echo "Creating Security Group: $SG_NAME"
    SG_ID=$(aws ec2 create-security-group --group-name $SG_NAME --description "Security group for EPM Serverless" --vpc-id $VPC_ID --query 'GroupId' --output text)
    
    # Allow self referencing for NFS (Lambda to EFS)
    aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 2049 --source-group $SG_ID > /dev/null
else
    echo "Security Group already exists: $SG_ID"
fi

# 4. Amazon EFS
EFS_TOKEN="epm-efs-storage"
EFS_ID=$(aws efs describe-file-systems --creation-token $EFS_TOKEN --query 'FileSystems[0].FileSystemId' --output text 2>/dev/null || echo "None")

if [ "$EFS_ID" == "None" ]; then
    echo "Creating Amazon EFS..."
    EFS_ID=$(aws efs create-file-system --creation-token $EFS_TOKEN --performance-mode generalPurpose --throughput-mode bursting --query 'FileSystemId' --output text)
    
    echo "Waiting for EFS to be available (this may take a few minutes)..."
    while true; do
        STATUS=$(aws efs describe-file-systems --file-system-id $EFS_ID --query 'FileSystems[0].LifeCycleState' --output text 2>/dev/null || echo "creating")
        if [ "$STATUS" == "available" ]; then
            echo "EFS is available!"
            break
        elif [ "$STATUS" == "deleted" ] || [ "$STATUS" == "error" ]; then
            echo "EFS creation failed (Status: $STATUS)."
            exit 1
        fi
        echo -n "."
        sleep 5
    done
    echo ""
else
    echo "Amazon EFS already exists: $EFS_ID"
fi

# Ensure Mount Targets exist for all subnets (even if EFS was already there)
echo "Checking and creating EFS Mount Targets..."
for SUBNET in "${SUBNET_ARRAY[@]}"; do
    TARGET_EXISTS=$(aws efs describe-mount-targets --file-system-id $EFS_ID --query "MountTargets[?SubnetId=='$SUBNET'].MountTargetId" --output text 2>/dev/null || echo "")
    if [ -z "$TARGET_EXISTS" ] || [ "$TARGET_EXISTS" == "None" ]; then
        echo "Creating Mount Target in Subnet: $SUBNET"
        aws efs create-mount-target --file-system-id $EFS_ID --subnet-id $SUBNET --security-groups $SG_ID > /dev/null || true
    else
        echo "Mount target already exists in Subnet: $SUBNET"
    fi
done

echo "Waiting for all EFS Mount Targets to be available..."
while true; do
    MT_STATUSES=$(aws efs describe-mount-targets --file-system-id $EFS_ID --query 'MountTargets[*].LifeCycleState' --output text 2>/dev/null || echo "creating")
    ALL_AVAILABLE=true
    for STATUS in $MT_STATUSES; do
        if [ "$STATUS" != "available" ]; then
            ALL_AVAILABLE=false
            break
        fi
    done
    
    if [ "$ALL_AVAILABLE" = true ] && [ -n "$MT_STATUSES" ]; then
        echo "All Mount Targets are available!"
        break
    fi
    echo -n "."
    sleep 5
done
echo ""

# 5. EFS Access Point
AP_ID=$(aws efs describe-access-points --file-system-id $EFS_ID --query "AccessPoints[?Name=='epm-ap'].AccessPointId" --output text || echo "None")
if [ "$AP_ID" == "None" ] || [ -z "$AP_ID" ]; then
    echo "Creating EFS Access Point..."
    AP_ID=$(aws efs create-access-point \
        --file-system-id $EFS_ID \
        --posix-user Uid=1000,Gid=1000 \
        --root-directory "Path=/appdata,CreationInfo={OwnerUid=1000,OwnerGid=1000,Permissions=777}" \
        --tags Key=Name,Value=epm-ap \
        --query 'AccessPointId' --output text)
else
     echo "EFS Access Point already exists: $AP_ID"
fi
AP_ARN="arn:aws:elasticfilesystem:${REGION}:${ACCOUNT_ID}:access-point/${AP_ID}"

# Pre-fetch CloudFront domain for CORS settings (used in Lambda env and Function URL)
echo "Fetching CloudFront distribution info for CORS configuration..."
DIST_ID=$(aws cloudfront list-distributions --query "DistributionList.Items[?Comment=='EPM Application CF'].Id" --output text 2>/dev/null || echo "")
CF_DOMAIN=""
if [ -n "$DIST_ID" ] && [ "$DIST_ID" != "None" ]; then
    CF_DOMAIN=$(aws cloudfront get-distribution --id "$DIST_ID" --query 'Distribution.DomainName' --output text 2>/dev/null || echo "")
fi
CF_ORIGIN=${CF_DOMAIN:+"https://$CF_DOMAIN"}
CORS_ORIGINS=${CF_ORIGIN:-"*"}
echo "CORS Allow Origin: $CORS_ORIGINS"

# 6. Lambda Function Deployment
LAMBDA_NAME="epm-backend"
echo "Packaging Backend Code..."
cd server
# npm_config_platform/arch を環境変数で指定することで、Windows/Mac/Linux どのホストからでも
# Linux arm64用のプリビルドバイナリ(ELF)をダウンロードできる
# (--platform/--arch フラグでは prebuild-install に正しく伝わらない場合があるため環境変数を使用)
rm -rf node_modules/sqlite3
npm_config_platform=linux npm_config_arch=arm64 npm install --omit=dev > /dev/null 2>&1
zip -q -r ../deploy-backend.zip . -x "*.git*" "*test*"
cd ..

echo "Checking Lambda Function..."
FUNCTION_EXISTS=$(aws lambda get-function --function-name $LAMBDA_NAME > /dev/null 2>&1 && echo "yes" || echo "no")

if [ "$FUNCTION_EXISTS" == "no" ]; then
    echo "Creating Lambda Function..."
    aws lambda create-function \
        --function-name $LAMBDA_NAME \
        --runtime nodejs20.x \
        --role $ROLE_ARN \
        --handler run.sh \
        --zip-file fileb://deploy-backend.zip \
        --timeout 900 \
        --memory-size 512 \
        --architectures arm64 \
        --environment "Variables={AWS_LAMBDA_EXEC_WRAPPER=/opt/bootstrap,PORT=8080,DB_PATH=/mnt/efs/database.sqlite,UPLOAD_DIR=/mnt/efs/uploads,S3_UPLOAD_BUCKET=epm-upload-$ACCOUNT_ID,S3_IMAGES_BUCKET=epm-images-$ACCOUNT_ID,ORIGIN_VERIFY_SECRET=$ORIGIN_VERIFY_SECRET,CORS_ALLOW_ORIGIN=$CORS_ORIGINS,AWS_LWA_PASS_THROUGH_PATH=/api/backup/export/worker}" \
        --vpc-config SubnetIds=$(echo "${SUBNET_ARRAY[*]}" | tr ' ' ','),SecurityGroupIds=$SG_ID \
        --file-system-configs Arn=$AP_ARN,LocalMountPath=/mnt/efs \
        --layers arn:aws:lambda:${REGION}:753240598075:layer:LambdaAdapterLayerArm64:24 > /dev/null
else
    echo "Updating Lambda Function Code..."
    aws lambda update-function-code \
        --function-name $LAMBDA_NAME \
        --zip-file fileb://deploy-backend.zip > /dev/null
    
    # Wait for update to complete before modifying config
    aws lambda wait function-updated --function-name $LAMBDA_NAME

    echo "Updating Lambda Function Configuration..."
    aws lambda update-function-configuration \
        --function-name $LAMBDA_NAME \
        --handler run.sh \
        --timeout 900 \
        --memory-size 512 \
        --environment "Variables={AWS_LAMBDA_EXEC_WRAPPER=/opt/bootstrap,PORT=8080,DB_PATH=/mnt/efs/database.sqlite,UPLOAD_DIR=/mnt/efs/uploads,S3_UPLOAD_BUCKET=epm-upload-$ACCOUNT_ID,S3_IMAGES_BUCKET=epm-images-$ACCOUNT_ID,ORIGIN_VERIFY_SECRET=$ORIGIN_VERIFY_SECRET,CORS_ALLOW_ORIGIN=$CORS_ORIGINS,AWS_LWA_PASS_THROUGH_PATH=/api/backup/export/worker}" \
        --vpc-config SubnetIds=$(echo "${SUBNET_ARRAY[*]}" | tr ' ' ','),SecurityGroupIds=$SG_ID \
        --file-system-configs Arn=$AP_ARN,LocalMountPath=/mnt/efs \
        --layers arn:aws:lambda:${REGION}:753240598075:layer:LambdaAdapterLayerArm64:24 > /dev/null
fi

# 7. Enable Function URL
echo "Configuring Lambda Function URL..."
URL_EXISTS=$(aws lambda get-function-url-config --function-name $LAMBDA_NAME > /dev/null 2>&1 && echo "yes" || echo "no")
if [ "$URL_EXISTS" == "no" ]; then
    FUNCTION_URL=$(aws lambda create-function-url-config \
        --function-name $LAMBDA_NAME \
        --auth-type NONE \
        --cors "AllowOrigins=$CORS_ORIGINS,AllowMethods=*,AllowHeaders=Content-Type,Authorization" \
        --query 'FunctionUrl' --output text)

    # Add public invocation permission (ensure statement exists and matches the policy)
    aws lambda add-permission \
        --function-name $LAMBDA_NAME \
        --statement-id FunctionURLAllowPublicAccess \
        --action lambda:InvokeFunctionUrl \
        --principal "*" \
        --function-url-auth-type NONE > /dev/null 2>&1 || true
else
    FUNCTION_URL=$(aws lambda get-function-url-config --function-name $LAMBDA_NAME --query 'FunctionUrl' --output text)
    # CORS設定を更新
    aws lambda update-function-url-config \
        --function-name $LAMBDA_NAME \
        --cors "AllowOrigins=$CORS_ORIGINS,AllowMethods=*,AllowHeaders=Content-Type,Authorization" > /dev/null
    # 既存のURL設定であっても、権限が不足している場合があるので再設定
    aws lambda add-permission \
        --function-name $LAMBDA_NAME \
        --statement-id FunctionURLAllowPublicAccess \
        --action lambda:InvokeFunctionUrl \
        --principal "*" \
        --function-url-auth-type NONE > /dev/null 2>&1 || true
fi

# 9. 非同期Invokeのリトライ無効化（二重実行防止）
echo "Disabling async invoke retries..."
aws lambda put-function-event-invoke-config \
    --function-name $LAMBDA_NAME \
    --maximum-retry-attempts 0 > /dev/null

# Configure S3 export trigger
echo "Configuring S3 export trigger..."
LAMBDA_ARN=$(aws lambda get-function --function-name $LAMBDA_NAME --query 'Configuration.FunctionArn' --output text)
aws lambda add-permission \
    --function-name $LAMBDA_NAME \
    --statement-id S3ExportTriggerPermission \
    --action lambda:InvokeFunction \
    --principal s3.amazonaws.com \
    --source-arn arn:aws:s3:::$UPLOAD_BUCKET > /dev/null 2>&1 || true

NOTIFICATION_CONFIG=$(cat <<NOTIFICATION_EOF
{
  "LambdaFunctionConfigurations": [{
    "Id": "ExportTrigger",
    "LambdaFunctionArn": "$LAMBDA_ARN",
    "Events": ["s3:ObjectCreated:*"],
    "Filter": {
      "Key": {
        "FilterRules": [{"Name": "prefix", "Value": "exports/triggers/"}]
      }
    }
  }]
}
NOTIFICATION_EOF
)
aws s3api put-bucket-notification-configuration \
    --bucket $UPLOAD_BUCKET \
    --notification-configuration "$NOTIFICATION_CONFIG"
echo "S3 export trigger configured."

# 8. Update CloudFront Origin Custom Headers (Issue #21)
# DIST_ID はセクション6前に取得済みのため再取得不要
if [ -n "$DIST_ID" ] && [ "$DIST_ID" != "None" ]; then
    echo "Updating CloudFront Origin Custom Headers for $DIST_ID..."
    aws cloudfront get-distribution-config --id "$DIST_ID" --output json > cf-config.json
    ETAG=$(jq -r '.ETag' cf-config.json)
    jq --arg secret "$ORIGIN_VERIFY_SECRET" \
        '.DistributionConfig.Origins.Items[] |= if .Id == "Lambda-Backend" then .CustomHeaders = {"Quantity": 1, "Items": [{"HeaderName": "x-origin-verify", "HeaderValue": $secret}]} else . end' \
        cf-config.json > cf-updated.json
    
    # Remove ETag and set it back to just DistributionConfig
    jq '.DistributionConfig' cf-updated.json > cf-final.json
    
    aws cloudfront update-distribution --id "$DIST_ID" --if-match "$ETAG" --distribution-config file://cf-final.json > /dev/null
    rm cf-config.json cf-updated.json cf-final.json
    echo "CloudFront update triggered. It may take a few minutes to propagate."
fi

echo ""
echo "=================================================="
echo "✅ Backend Deployment Complete!"
echo "🚀 Lambda Function URL: $FUNCTION_URL"
echo "=================================================="
echo "Next steps:"
echo "1. Create client/.env.production and add:"
echo "   VITE_API_BASE_URL=$FUNCTION_URL"
echo "2. Run 'npm run build' in the client directory."
echo "3. Deploy client/dist to S3/CloudFront."
