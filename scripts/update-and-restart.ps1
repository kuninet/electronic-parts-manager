# Electronic Parts Manager - ワンクリック自動更新・再起動スクリプト
# PS 5.1 / PS 7 両対応 (UTF-8 BOM / CRLF)

[CmdletBinding()]
param(
    [switch]$Force,              # 更新が無くても再ビルド・再起動する
    [int]$KeepBackups = 20,      # DB バックアップの保持世代数
    [int]$HealthTimeoutSec = 60,
    [switch]$Reinstall           # 全ディレクトリで npm ci を強制（node_modules 破損時の復旧用）
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. (Join-Path $PSScriptRoot 'lib\epm-common.ps1')
$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $script:RepoRoot

$state = [ordered]@{
    Stopped       = $false   # pm2 stop 済み
    BackupPath    = $null    # DB バックアップのパス
    PrevCommit    = $null
    Pulled        = $false
    CiDirs        = @()      # npm ci を実行したディレクトリ
    DistSwapped   = $false
    NewStarted    = $false   # 新コードで pm2 startOrRestart 済み
    Success       = $false
    UploadsBefore = 0
}
$exitCode = 1
$startTime = Get-Date

# 二重起動防止ミューテックス
$mutexCreated = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\epm-update-and-restart', [ref]$mutexCreated)
if (-not $mutexCreated -and -not $mutex.WaitOne(0, $false)) {
    Write-Host "[ERR] 別の更新処理が実行中です。完了するまでお待ちください。" -ForegroundColor Red
    exit 1
}

try {
    # 1. ログ初期化
    $logPath = Initialize-EpmLog -Name 'update'
    Write-EpmLog -Level STEP -Message "=== Electronic Parts Manager 自動更新開始 ==="
    Write-EpmLog -Level INFO -Message ("リポジトリ: {0}" -f $script:RepoRoot)
    Write-EpmLog -Level INFO -Message ("ログファイル: {0}" -f $logPath)

    # 2. 前提コマンドとNode.jsバージョン確認
    if (-not (Test-Prerequisites)) {
        Write-EpmLog -Level ERR -Message "前提コマンドが不足しているため処理を中断します。"
        $exitCode = 1
        return
    }
    if (-not (Test-NodeVersion)) {
        Write-EpmLog -Level ERR -Message "Node.js バージョン要件を満たしていないため処理を中断します。"
        $exitCode = 1
        return
    }

    $paths = Get-EpmPaths -RepoRoot $script:RepoRoot

    # 3. PM2 登録状態確認
    if (-not (Test-Path -LiteralPath $paths.Ecosystem)) {
        Write-EpmLog -Level ERR -Message "ecosystem.config.js が見つかりません。"
        $exitCode = 1
        return
    }
    $currentApps = Get-Pm2Apps
    $hasServer = $null -ne ($currentApps | Where-Object { $_.name -eq 'epm-server' })
    $hasWeb = $null -ne ($currentApps | Where-Object { $_.name -eq 'epm-web' })
    if (-not $hasServer -or -not $hasWeb) {
        Write-EpmLog -Level ERR -Message "PM2 に EPM が登録されていません。初回は scripts\pm2-register.bat を実行してください。"
        $exitCode = 1
        return
    }

    # 4. Git ブランチ確認
    $branchOut = @(Get-GitOutput @('branch', '--show-current'))
    if (-not $branchOut -or -not $branchOut[0]) {
        Write-EpmLog -Level ERR -Message "ブランチを取得できません（detached HEAD の可能性があります）。"
        $exitCode = 1
        return
    }
    $currentBranch = $branchOut[0].Trim()
    if ($currentBranch -ne 'main') {
        Write-EpmLog -Level WARN -Message ("現在 main 以外のブランチ ({0}) で作業しています。" -f $currentBranch)
    }

    # 5. 未コミット変更の確認
    $uncommitted = @(Get-GitOutput @('status', '--porcelain', '--untracked-files=no'))
    if ($uncommitted.Count -gt 0) {
        Write-EpmLog -Level ERR -Message "未コミットの変更が存在します。git stash するかコミットしてから再実行してください。"
        foreach ($line in $uncommitted) {
            Write-EpmLog -Level INFO -Message ("  {0}" -f $line)
        }
        $exitCode = 1
        return
    }

    # 6. uploads ディレクトリの追跡確認
    $trackedUploads = @(Get-GitOutput @('ls-files', '--', 'uploads'))
    if ($trackedUploads.Count -gt 0) {
        Write-EpmLog -Level ERR -Message "uploads ディレクトリ内のファイルが Git で追跡されています。保護のため中断します。"
        $exitCode = 1
        return
    }

    # 7. リモートから最新情報を取得
    Write-EpmLog -Level STEP -Message ("リモートの更新を確認中 (git fetch origin {0})..." -f $currentBranch)
    try {
        $null = Invoke-Native -FilePath 'git' -ArgumentList @('fetch', 'origin', $currentBranch)
    } catch {
        Write-EpmLog -Level ERR -Message "git fetch に失敗しました。ネットワーク接続を確認してください。"
        $exitCode = 1
        return
    }

    # 8. 更新要否と fast-forward 判定
    $localCommit = @(Get-GitOutput @('rev-parse', 'HEAD'))[0].Trim()
    $remoteRef = ("origin/{0}" -f $currentBranch)
    $remoteCommit = @(Get-GitOutput @('rev-parse', $remoteRef))[0].Trim()

    if (($localCommit -eq $remoteCommit) -and -not $Force -and -not $Reinstall) {
        $shortLocal = $localCommit.Substring(0, [System.Math]::Min(7, $localCommit.Length))
        Write-EpmLog -Level OK -Message ("既に最新です ({0})。更新処理をスキップします。" -f $shortLocal)
        $exitCode = 0
        return
    }

    # merge-base --is-ancestor チェック
    $ffCheckCode = Invoke-Native -FilePath 'git' -ArgumentList @('merge-base', '--is-ancestor', 'HEAD', $remoteRef) -AllowFailure
    if ($ffCheckCode -ne 0) {
        Write-EpmLog -Level ERR -Message "ローカルにリモートに存在しないコミットがあります。fast-forward できません。"
        $exitCode = 1
        return
    }

    # 9. 作業計画の策定
    $changedFiles = @(Get-GitOutput @('diff', '--name-only', 'HEAD', $remoteRef))
    $ciRoot = ($changedFiles -contains 'package.json') -or ($changedFiles -contains 'package-lock.json') -or (-not (Test-Path (Join-Path $script:RepoRoot 'node_modules')))
    $ciServer = ($changedFiles -match '^server/(package\.json|package-lock\.json)$') -or (-not (Test-Path (Join-Path $paths.ServerDir 'node_modules')))
    $ciClient = ($changedFiles -match '^client/(package\.json|package-lock\.json)$') -or (-not (Test-Path (Join-Path $paths.ClientDir 'node_modules')))

    if ($Reinstall) {
        $ciRoot = $true
        $ciServer = $true
        $ciClient = $true
    }

    # package-lock.json の存在確認
    if (-not (Test-Path (Join-Path $script:RepoRoot 'package-lock.json')) -or
        -not (Test-Path (Join-Path $paths.ServerDir 'package-lock.json')) -or
        -not (Test-Path (Join-Path $paths.ClientDir 'package-lock.json'))) {
        Write-EpmLog -Level ERR -Message "package-lock.json が不足しているため npm ci を実行できません。"
        $exitCode = 1
        return
    }

    $needBuild = ($changedFiles -match '^client/') -or $ciClient -or (-not (Test-Path (Join-Path $paths.ClientDir 'dist'))) -or $Force -or $Reinstall

    Write-EpmLog -Level INFO -Message "【作業計画】"
    Write-EpmLog -Level INFO -Message ("  npm ci (server): {0}" -f ($(if ($ciServer) { '実行' } else { '不要' })))
    Write-EpmLog -Level INFO -Message ("  npm ci (client): {0}" -f ($(if ($ciClient) { '実行' } else { '不要' })))
    Write-EpmLog -Level INFO -Message ("  npm ci (root)  : {0}" -f ($(if ($ciRoot) { '実行' } else { '不要' })))
    Write-EpmLog -Level INFO -Message ("  client build   : {0}" -f ($(if ($needBuild) { '実行' } else { '不要' })))

    $commits = @(Get-GitOutput @('log', '--oneline', ("HEAD..{0}" -f $remoteRef)))
    if ($commits.Count -gt 0) {
        Write-EpmLog -Level INFO -Message "【適用されるコミット】"
        foreach ($c in $commits) {
            Write-EpmLog -Level INFO -Message ("  {0}" -f $c)
        }
    }

    # 10. ポート競合の事前確認
    $serverAppStatus = ($currentApps | Where-Object { $_.name -eq 'epm-server' }).status
    $webAppStatus = ($currentApps | Where-Object { $_.name -eq 'epm-web' }).status

    if ($webAppStatus -ne 'online' -and -not (Test-PortFree -Port $paths.WebPort)) {
        Write-EpmLog -Level ERR -Message ("ポート {0} が start_app.bat 等の別プロセスで使用されています。" -f $paths.WebPort)
        $exitCode = 1
        return
    }
    if ($serverAppStatus -ne 'online' -and -not (Test-PortFree -Port $paths.ApiPort)) {
        Write-EpmLog -Level ERR -Message ("ポート {0} が別プロセスで使用されています。" -f $paths.ApiPort)
        $exitCode = 1
        return
    }
    if ($paths.ApiPort -ne 3001) {
        Write-EpmLog -Level WARN -Message ("server/.env の PORT が 3001 以外 ({0}) に設定されています。" -f $paths.ApiPort)
    }

    # ==========================
    # ここから更新フェーズ (try)
    # ==========================
    try {
        $state.UploadsBefore = Get-FileCountSafe -Path $paths.UploadDir
        $state.PrevCommit = $localCommit
        Write-EpmLog -Level INFO -Message ("更新前コミット: {0}" -f $localCommit)
        Write-EpmLog -Level INFO -Message ("対象コミット  : {0}" -f $remoteCommit)

        # 11. PM2 停止
        Stop-EpmApps -Ecosystem $paths.Ecosystem
        $state.Stopped = $true

        # 12. SQLite DB バックアップ (D8)
        if (Test-Path -LiteralPath $paths.DbPath) {
            if (-not (Test-Path -LiteralPath $paths.BackupDir)) {
                New-Item -ItemType Directory -Path $paths.BackupDir -Force -ErrorAction Stop | Out-Null
            }
            $dbTimestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
            $backupFile = Join-Path $paths.BackupDir ("database-{0}.sqlite" -f $dbTimestamp)
            Copy-Item -LiteralPath $paths.DbPath -Destination $backupFile -Force -ErrorAction Stop

            # -journal / -wal / -shm の同時コピー
            $dbDir = [System.IO.Path]::GetDirectoryName($paths.DbPath)
            $dbName = [System.IO.Path]::GetFileName($paths.DbPath)
            foreach ($ext in @('-journal', '-wal', '-shm')) {
                $extraFile = Join-Path $dbDir ($dbName + $ext)
                if (Test-Path -LiteralPath $extraFile) {
                    $backupExtra = Join-Path $paths.BackupDir ("database-{0}.sqlite{1}" -f $dbTimestamp, $ext)
                    Copy-Item -LiteralPath $extraFile -Destination $backupExtra -Force -ErrorAction SilentlyContinue
                }
            }

            # ハッシュ検証
            $srcHash = (Get-FileHash -LiteralPath $paths.DbPath -Algorithm SHA256).Hash
            $dstHash = (Get-FileHash -LiteralPath $backupFile -Algorithm SHA256).Hash
            if ($srcHash -ne $dstHash) {
                throw ("DBバックアップのハッシュ不一致 (元: {0}, 先: {1})" -f $srcHash, $dstHash)
            }

            $state.BackupPath = $backupFile
            Write-EpmLog -Level OK -Message ("DB バックアップ完了: {0}" -f $backupFile)
            Remove-OldDbBackups -BackupDir $paths.BackupDir -Keep $KeepBackups
        } else {
            Write-EpmLog -Level WARN -Message "DB ファイルが存在しません (初回起動)。バックアップをスキップします。"
        }

        # 13. Git Pull (--ff-only)
        Write-EpmLog -Level STEP -Message ("最新コードを取得中 (git pull --ff-only origin {0})..." -f $currentBranch)
        $null = Invoke-Native -FilePath 'git' -ArgumentList @('pull', '--ff-only', 'origin', $currentBranch)
        $state.Pulled = $true

        # 14. 依存関係の更新 (npm ci: server -> client -> root)
        if ($ciServer) {
            $state.CiDirs += $paths.ServerDir
            Write-EpmLog -Level STEP -Message "server 依存関係をインストール中 (npm ci)..."
            $code = Invoke-Native -FilePath 'npm' -ArgumentList @('ci') -WorkingDirectory $paths.ServerDir -AllowFailure
            if ($code -ne 0) {
                Write-EpmLog -Level WARN -Message "npm ci が失敗しました。5秒後に再試行します..."
                Start-Sleep -Seconds 5
                $null = Invoke-Native -FilePath 'npm' -ArgumentList @('ci') -WorkingDirectory $paths.ServerDir
            }
        }

        if ($ciClient) {
            $state.CiDirs += $paths.ClientDir
            Write-EpmLog -Level STEP -Message "client 依存関係をインストール中 (npm ci)..."
            $code = Invoke-Native -FilePath 'npm' -ArgumentList @('ci') -WorkingDirectory $paths.ClientDir -AllowFailure
            if ($code -ne 0) {
                Write-EpmLog -Level WARN -Message "npm ci が失敗しました。5秒後に再試行します..."
                Start-Sleep -Seconds 5
                $null = Invoke-Native -FilePath 'npm' -ArgumentList @('ci') -WorkingDirectory $paths.ClientDir
            }
        }

        if ($ciRoot) {
            $state.CiDirs += $script:RepoRoot
            Write-EpmLog -Level STEP -Message "root 依存関係をインストール中 (npm ci)..."
            $code = Invoke-Native -FilePath 'npm' -ArgumentList @('ci') -WorkingDirectory $script:RepoRoot -AllowFailure
            if ($code -ne 0) {
                Write-EpmLog -Level WARN -Message "npm ci が失敗しました。5秒後に再試行します..."
                Start-Sleep -Seconds 5
                $null = Invoke-Native -FilePath 'npm' -ArgumentList @('ci') -WorkingDirectory $script:RepoRoot
            }
        }

        # 15. クライアントビルド (dist.next へアトミックビルド) と dist の安全な入れ替え
        if ($needBuild) {
            Invoke-ClientBuild -ClientDir $paths.ClientDir
            $state.DistSwapped = Switch-ClientDist -ClientDir $paths.ClientDir
        }

        # 16. PM2 再起動
        Start-EpmApps -Ecosystem $paths.Ecosystem
        $state.NewStarted = $true

        # 17. ヘルスチェック待機 (/api/health へのポーリング)
        $isHealthy = Wait-EpmHealthy -Paths $paths -TimeoutSec $HealthTimeoutSec
        if (-not $isHealthy) {
            throw "ヘルスチェックに失敗しました (サービスが正常起動しませんでした)"
        }

        # 18. uploads 件数チェック (D9)
        $uploadsAfter = Get-FileCountSafe -Path $paths.UploadDir
        if ($uploadsAfter -lt $state.UploadsBefore) {
            Write-EpmLog -Level WARN -Message ("uploads ディレクトリ内のファイル数が減少しています (更新前: {0}, 更新後: {1})" -f $state.UploadsBefore, $uploadsAfter)
        }

        # 19. PM2 状態保存
        $null = Invoke-Native -FilePath 'pm2' -ArgumentList @('save')

        $state.Success = $true
        $exitCode = 0

        # 成功サマリ表示
        $duration = ((Get-Date) - $startTime).TotalSeconds
        $newCommitShort = @(Get-GitOutput @('rev-parse', '--short', 'HEAD'))[0].Trim()
        Write-EpmLog -Level OK -Message "=================================================="
        Write-EpmLog -Level OK -Message ("自動更新が正常に完了しました！ (所要時間: {0:N1} 秒)" -f $duration)
        Write-EpmLog -Level OK -Message ("新バージョン: {0}" -f $newCommitShort)
        if ($state.BackupPath) {
            Write-EpmLog -Level OK -Message ("DB バックアップ: {0}" -f $state.BackupPath)
        }

        # プライベート IP アドレス特定
        $ip = 'localhost'
        try {
            $nicIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
                Select-Object -First 1
            if ($nicIp) {
                $ip = $nicIp.IPAddress
            }
        } catch {}
        Write-EpmLog -Level OK -Message ("アクセス URL: {0}://{1}:{2}" -f $paths.WebScheme, $ip, $paths.WebPort)
        Write-EpmLog -Level OK -Message "=================================================="

    } catch {
        Write-EpmLog -Level ERR -Message ("更新処理中にエラーが発生しました: {0}" -f $_.Exception.Message)
        if ($_.ScriptStackTrace) {
            Write-EpmLog -Level ERR -Message ("スタックトレース: {0}" -f $_.ScriptStackTrace)
        }
    } finally {
        # ==========================
        # ロールバックフェーズ (finally)
        # ==========================
        if ($state.Stopped -and -not $state.Success) {
            Write-EpmLog -Level WARN -Message "更新に失敗したため、旧バージョンへ戻します..."
            $rollbackFailed = $false

            # 0. 新コード起動後に失敗した場合は、DLL・ファイルロック解除のため直ちに停止
            if ($state.NewStarted) {
                try {
                    Write-EpmLog -Level STEP -Message "ロールバック処理のため稼働中プロセスを停止中..."
                    Stop-EpmApps -Ecosystem $paths.Ecosystem
                } catch {
                    Write-EpmLog -Level WARN -Message ("プロセス停止中に警告: {0}" -f $_.Exception.Message)
                }
            }

            # 1. dist 復元
            if ($state.DistSwapped) {
                try {
                    Restore-ClientDist -ClientDir $paths.ClientDir
                } catch {
                    $rollbackFailed = $true
                    Write-EpmLog -Level ERR -Message ("dist 復元失敗: {0}" -f $_.Exception.Message)
                }
            }

            # 2. git reset --hard
            if ($state.Pulled -and $state.PrevCommit) {
                try {
                    Write-EpmLog -Level STEP -Message ("コードを更新前のコミット ({0}) に復元中..." -f $state.PrevCommit)
                    $null = Invoke-Native -FilePath 'git' -ArgumentList @('reset', '--hard', $state.PrevCommit)
                } catch {
                    $rollbackFailed = $true
                    Write-EpmLog -Level ERR -Message ("git reset 失敗: {0}" -f $_.Exception.Message)
                }
            }

            # 3. npm ci 復元
            if ($state.CiDirs.Count -gt 0) {
                foreach ($ciDir in $state.CiDirs) {
                    try {
                        Write-EpmLog -Level STEP -Message ("旧依存関係を復元中: {0}..." -f $ciDir)
                        $null = Invoke-Native -FilePath 'npm' -ArgumentList @('ci') -WorkingDirectory $ciDir
                    } catch {
                        $rollbackFailed = $true
                        Write-EpmLog -Level ERR -Message ("旧依存 npm ci 復元失敗: {0}" -f $_.Exception.Message)
                    }
                }
            }

            # 4. DB 復元（新コード起動後の失敗時のみ）
            if ($state.NewStarted -and $state.BackupPath) {

                # 失敗時DBの退避
                if (Test-Path -LiteralPath $paths.DbPath) {
                    $failTimestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
                    $failedDbPath = Join-Path $paths.BackupDir ("database-failed-{0}.sqlite" -f $failTimestamp)
                    try {
                        Copy-Item -LiteralPath $paths.DbPath -Destination $failedDbPath -Force -ErrorAction Stop
                        Write-EpmLog -Level INFO -Message ("失敗時のDBを退避しました: {0}" -f $failedDbPath)
                    } catch {
                        Write-EpmLog -Level WARN -Message ("失敗時DBの退避失敗: {0}" -f $_.Exception.Message)
                    }
                }

                # バックアップから復元
                try {
                    Copy-Item -LiteralPath $state.BackupPath -Destination $paths.DbPath -Force -ErrorAction Stop
                    Write-EpmLog -Level OK -Message "DB を更新前のバックアップから復元しました"

                    # -journal / -wal / -shm のクリーンアップ
                    $dbDir = [System.IO.Path]::GetDirectoryName($paths.DbPath)
                    $dbName = [System.IO.Path]::GetFileName($paths.DbPath)
                    foreach ($ext in @('-journal', '-wal', '-shm')) {
                        $extraFile = Join-Path $dbDir ($dbName + $ext)
                        if (Test-Path -LiteralPath $extraFile) {
                            Remove-Item -LiteralPath $extraFile -Force -ErrorAction SilentlyContinue
                        }
                    }
                } catch {
                    $rollbackFailed = $true
                    Write-EpmLog -Level ERR -Message ("DB 復元失敗: {0}" -f $_.Exception.Message)
                }
            }

            # 5. 旧バージョンでの再起動とヘルスチェック
            try {
                Start-EpmApps -Ecosystem $paths.Ecosystem
                $oldHealthy = Wait-EpmHealthy -Paths $paths -TimeoutSec $HealthTimeoutSec
                if (-not $oldHealthy) {
                    $rollbackFailed = $true
                }
            } catch {
                $rollbackFailed = $true
            }

            # 6. uploads ファイル数確認
            $uploadsAfterRollback = Get-FileCountSafe -Path $paths.UploadDir
            if ($uploadsAfterRollback -lt $state.UploadsBefore) {
                Write-EpmLog -Level WARN -Message ("uploads ディレクトリ内のファイル数が減少しています (更新前: {0}, ロールバック後: {1})" -f $state.UploadsBefore, $uploadsAfterRollback)
            }

            # 7. ロールバック結果判定
            if (-not $rollbackFailed) {
                $prevShort = $state.PrevCommit.Substring(0, [System.Math]::Min(7, $state.PrevCommit.Length))
                Write-EpmLog -Level OK -Message ("旧バージョン ({0}) で復旧しました。" -f $prevShort)
                $exitCode = 2
            } else {
                Write-EpmLog -Level ERR -Message "自動復旧に失敗しました。docs/WINDOWS_SETUP.md の『手動ロールバック』を参照してください。"
                Write-EpmLog -Level ERR -Message ("ログファイル: {0}" -f $script:EpmLogFile)
                $exitCode = 3
            }
        }
    }
} finally {
    try {
        $mutex.ReleaseMutex()
    } catch {}
    $mutex.Dispose()
}

exit $exitCode
