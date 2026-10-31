# Electronic Parts Manager - PM2 常駐登録・自動起動セットアップ
# PS 5.1 / PS 7 両対応 (UTF-8 BOM / CRLF)

[CmdletBinding()]
param(
    [switch]$NoStartup          # スタートアップへの登録をスキップする
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. (Join-Path $PSScriptRoot 'lib\epm-common.ps1')
$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $script:RepoRoot

$logPath = Initialize-EpmLog -Name 'register'
Write-EpmLog -Level STEP -Message "=== Electronic Parts Manager PM2 サービス登録 ==="
Write-EpmLog -Level INFO -Message ("リポジトリ: {0}" -f $script:RepoRoot)
Write-EpmLog -Level INFO -Message ("ログファイル: {0}" -f $logPath)

# 1. 前提コマンドと Node.js バージョン確認
if (-not (Test-Prerequisites)) {
    Write-EpmLog -Level ERR -Message "前提コマンドが不足しているため処理を中断します。"
    exit 1
}
if (-not (Test-NodeVersion)) {
    Write-EpmLog -Level ERR -Message "Node.js バージョン要件を満たしていないため処理を中断します。"
    exit 1
}

$paths = Get-EpmPaths -RepoRoot $script:RepoRoot

try {
    $currentApps = Get-Pm2Apps
} catch {
    Write-EpmLog -Level ERR -Message ("PM2 の状態を取得できませんでした: {0}" -f $_.Exception.Message)
    exit 1
}
$serverApp = $currentApps | Where-Object { $_.name -eq 'epm-server' }
$webApp = $currentApps | Where-Object { $_.name -eq 'epm-web' }
$mcpApp = $currentApps | Where-Object { $_.name -eq 'epm-mcp' }
if (($null -ne $serverApp -and $serverApp.status -eq 'online') -or ($null -ne $webApp -and $webApp.status -eq 'online') -or ($null -ne $mcpApp -and $mcpApp.status -eq 'online')) {
    Write-EpmLog -Level STEP -Message "既存の EPM プロセスが稼働中のため、安全に停止します..."
    Stop-EpmApps -Ecosystem $paths.Ecosystem
}

# 3. ポート競合確認 (別プロセスの使用を検出)
if (-not (Test-PortFree -Port $paths.WebPort)) {
    Write-EpmLog -Level ERR -Message ("ポート {0} が別プロセスで使用中です。start_app.bat 等のウィンドウをすべて閉じてから再実行してください。" -f $paths.WebPort)
    exit 1
}
if (-not (Test-PortFree -Port $paths.ApiPort)) {
    Write-EpmLog -Level ERR -Message ("ポート {0} が別プロセスで使用中です。start_app.bat 等のウィンドウをすべて閉じてから再実行してください。" -f $paths.ApiPort)
    exit 1
}

if (-not (Test-PortFree -Port $paths.McpPort)) {
    # MCP は付加機能のため、ポートが使用中でも本体アプリの登録は続行する
    Write-EpmLog -Level WARN -Message ("MCP 用ポート {0} が別プロセスで使用中です。epm-mcp が起動できない可能性があります (本体アプリの登録は続行します)。" -f $paths.McpPort)
}

# 4. 依存関係のインストール（登録時は確実に最新の依存関係を整合）
$dirs = @($paths.ServerDir, $paths.ClientDir, $script:RepoRoot)
foreach ($d in $dirs) {
    if (Test-Path -LiteralPath (Join-Path $d 'package-lock.json')) {
        Write-EpmLog -Level STEP -Message ("依存関係をインストール中: {0} (npm ci)..." -f $d)
        $null = Invoke-Native -FilePath 'npm' -ArgumentList @('ci') -WorkingDirectory $d
    }
}

# 5. フロントエンドのビルド実行（登録時は確実に最新成果物を配置）
Write-EpmLog -Level STEP -Message "フロントエンドのビルドを実行します..."
Invoke-ClientBuild -ClientDir $paths.ClientDir
$null = Switch-ClientDist -ClientDir $paths.ClientDir

# 6. PM2 アプリケーションの登録と起動
Write-EpmLog -Level STEP -Message "PM2 にアプリケーションを登録・起動します..."
Start-EpmApps -Ecosystem $paths.Ecosystem

# 7. ヘルスチェック待機
$isHealthy = Wait-EpmHealthy -Paths $paths -TimeoutSec 60
if (-not $isHealthy) {
    Write-EpmLog -Level ERR -Message "アプリケーションの正常起動を確認できませんでした。ログを確認します:"
    $null = Invoke-Native -FilePath 'pm2' -ArgumentList @('logs', '--lines', '50', '--nostream') -AllowFailure
    exit 1
}

# 7-2. MCP サーバーのヘルスチェック (失敗しても WARN のみで続行)
$null = Test-EpmMcpHealthy -Paths $paths

# 8. PM2 状態保存
Write-EpmLog -Level STEP -Message "PM2 プロセス構成を保存中 (pm2 save)..."
$null = Invoke-Native -FilePath 'pm2' -ArgumentList @('save')

# 8. ログローテーション設定
Write-EpmLog -Level STEP -Message "ログローテーション (pm2-logrotate) 設定を確認中..."
try {
    $hasLogrotate = $false
    $jlist = pm2 jlist 2>$null
    if ($jlist -and ($jlist | Where-Object { $_ -match 'pm2-logrotate' })) {
        $hasLogrotate = $true
    }
    if (-not $hasLogrotate) {
        Write-EpmLog -Level INFO -Message "pm2-logrotate をインストールします..."
        $null = Invoke-Native -FilePath 'pm2' -ArgumentList @('install', 'pm2-logrotate') -AllowFailure
    }
    $null = Invoke-Native -FilePath 'pm2' -ArgumentList @('set', 'pm2-logrotate:max_size', '10M') -AllowFailure
    $null = Invoke-Native -FilePath 'pm2' -ArgumentList @('set', 'pm2-logrotate:retain', '10') -AllowFailure
    Write-EpmLog -Level OK -Message "pm2-logrotate を設定しました (10MB x 10世代)"
} catch {
    Write-EpmLog -Level WARN -Message ("pm2-logrotate 設定をスキップしました: {0}" -f $_.Exception.Message)
}

# 9. スタートアップショートカット作成
if (-not $NoStartup) {
    try {
        Write-EpmLog -Level STEP -Message "PC 再起動時の自動復旧ショートカットをスタートアップに登録中..."
        $startup = [Environment]::GetFolderPath('Startup')
        $lnkPath = Join-Path $startup 'EPM - pm2 resurrect.lnk'
        $ws = New-Object -ComObject WScript.Shell
        $lnk = $ws.CreateShortcut($lnkPath)
        $lnk.TargetPath = (Get-Command powershell.exe).Source
        $lnk.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "pm2 resurrect"'
        $lnk.WorkingDirectory = $script:RepoRoot
        $lnk.WindowStyle = 7
        $lnk.Description = 'Electronic Parts Manager: PM2 プロセスを復元'
        $lnk.Save()
        Write-EpmLog -Level OK -Message ("スタートアップショートカットを作成しました: {0}" -f $lnkPath)
    } catch {
        Write-EpmLog -Level WARN -Message ("スタートアップショートカットの作成に失敗しました: {0}" -f $_.Exception.Message)
    }
}

# 10. 完了サマリと案内表示
$ip = 'localhost'
try {
    $nicIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
        Select-Object -First 1
    if ($nicIp) {
        $ip = $nicIp.IPAddress
    }
} catch {}

Write-EpmLog -Level OK -Message "=================================================="
Write-EpmLog -Level OK -Message "PM2 へのサービス登録が正常に完了しました！"
Write-EpmLog -Level OK -Message ("アクセス URL: {0}://{1}:{2}" -f $paths.WebScheme, $ip, $paths.WebPort)
Write-EpmLog -Level OK -Message ("MCP URL: http://{0}:{1}/mcp" -f $ip, $paths.McpPort)
Write-EpmLog -Level OK -Message "運用手順・ショートカット作成手順は docs/WINDOWS_SETUP.md を参照してください。"
Write-EpmLog -Level OK -Message "=================================================="

$null = Invoke-Native -FilePath 'pm2' -ArgumentList @('ls') -AllowFailure
exit 0
