#!/bin/bash
# AWS Serverless Deployment Script for Electronic Parts Manager
# This script automates the creation of AWS resources using AWS CLI.

set -e

REGION="ap-northeast-1"
export AWS_DEFAULT_REGION=$REGION

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Deploying to AWS Account: $ACCOUNT_ID"

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
        --root-directory "Path=/,CreationInfo={OwnerUid=1000,OwnerGid=1000,Permissions=777}" \
        --tags Key=Name,Value=epm-ap \
        --query 'AccessPointId' --output text)
else
     echo "EFS Access Point already exists: $AP_ID"
fi
AP_ARN="arn:aws:elasticfilesystem:${REGION}:${ACCOUNT_ID}:access-point/${AP_ID}"


# 6. Lambda Function Deployment
LAMBDA_NAME="epm-backend"
echo "Packaging Backend Code..."
cd server
npm ci --omit=dev  > /dev/null 2>&1
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
        --timeout 30 \
        --memory-size 256 \
        --architectures arm64 \
        --environment "Variables={AWS_LAMBDA_EXEC_WRAPPER=/opt/bootstrap,PORT=8080,DB_PATH=/mnt/efs/database.sqlite,UPLOAD_DIR=/mnt/efs/uploads}" \
        --vpc-config SubnetIds=$(echo "${SUBNET_ARRAY[*]}" | tr ' ' ','),SecurityGroupIds=$SG_ID \
        --file-system-configs Arn=$AP_ARN,LocalMountPath=/mnt/efs \
        --layers arn:aws:lambda:${REGION}:753240598075:layer:LambdaAdapterLayerArm64:24 > /dev/null
        # Set to arm64 because the package is likely built on an Apple Silicon Mac, containing native ARM sqlite3 bindings.
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
        --environment "Variables={AWS_LAMBDA_EXEC_WRAPPER=/opt/bootstrap,PORT=8080,DB_PATH=/mnt/efs/database.sqlite,UPLOAD_DIR=/mnt/efs/uploads}" \
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
        --cors "AllowOrigins=*,AllowMethods=*,AllowHeaders=*" \
        --query 'FunctionUrl' --output text)
    
    # Add public invocation permission
    aws lambda add-permission \
        --function-name $LAMBDA_NAME \
        --statement-id FunctionURLAllowPublicAccess \
        --action lambda:InvokeFunctionUrl \
        --principal "*" \
        --function-url-auth-type NONE > /dev/null
else
    FUNCTION_URL=$(aws lambda get-function-url-config --function-name $LAMBDA_NAME --query 'FunctionUrl' --output text)
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
