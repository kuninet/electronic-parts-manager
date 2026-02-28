# EFS 確認用 踏み台 (Bastion) ボーストへのアクセスガイド

AWS サーバレス環境で利用している EFS (Elastic File System) の内容を直接確認するための、踏み台 EC2 インスタンス (`epm-efs-bastion`) の使用方法です。
※ この情報はセキュリティに関わるため、公開ドキュメント（`docs/` 以下）には含めず、ローカルのメモリとして保持しています。

## 概要
- **インスタンス名**: `epm-efs-bastion` (t4g.nano)
- **状態**: 基本は「停止 (Stopped)」状態です。課金を抑えるため、**確認したい時だけ起動し、終わったら必ず停止**してください。
- **マウント先**: EFS は EC2 内の `/mnt/efs` にマウントされます。

## アクセス手順

### 1. インスタンスの起動
AWS CLI、または AWS マネジメントコンソールからインスタンスを起動します。

**AWS CLI を使う場合:**
```bash
aws ec2 start-instances --instance-ids i-0bdf33282da90f232
```

### 2. パブリック IP の取得
起動後、インスタンスに割り当てられたパブリック IP アドレスを確認します。

**AWS CLI を使う場合:**
```bash
aws ec2 describe-instances --instance-ids i-0bdf33282da90f232 --query 'Reservations[0].Instances[0].PublicIpAddress' --output text
```

### 3. SSH 接続と EFS の確認
取得した IP アドレスと、プロジェクトルートにある秘密鍵 (`epm-bastion-key.pem`) を使用して SSH 接続します。

```bash
# 例: IP アドレスが 198.51.100.10 の場合
ssh -i epm-bastion-key.pem ec2-user@198.51.100.10
```

接続後、EFS は自動でマウントされない場合は、以下のコマンドでマウントして確認します。
（通常は fstab 等に書いていなければ都度マウントが必要です。今回手動マウントしました）

```bash
# マウントコマンド
sudo mount -t efs fs-04b8b1ef4ad20e4ec:/ /mnt/efs

# 中身の確認
ls -la /mnt/efs/appdata
```

### 4. 【重要】インスタンスの停止
確認が終了したら、AWS コンソールから、または CLI で**必ずインスタンスを停止**してください。

**AWS CLI を使う場合:**
```bash
aws ec2 stop-instances --instance-ids i-0bdf33282da90f232
```

## 注意事項
- 秘密鍵 (`epm-bastion-key.pem`) は `.gitignore` に登録されており、Git の管理下にはありません。このファイルは紛失しないようローカルで厳重に保管してください。
- この踏み台は EFS アクセス用 SG に所属しているため、EFS にアクセス可能です。
