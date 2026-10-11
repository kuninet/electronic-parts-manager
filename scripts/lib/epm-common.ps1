# Electronic Parts Manager - 共通 PowerShell 関数ライブラリ
# PS 5.1 / PS 7 両対応 (UTF-8 BOM / CRLF)

function Initialize-EpmLog {
    param([Parameter(Mandatory = $true)][string]$Name)
    $repoRoot = Get-RepoRoot
    $logDir = Join-Path $repoRoot ("logs\{0}" -f $Name)
    if (-not (Test-Path -LiteralPath $logDir)) {
        New-Item -ItemType Directory -LiteralPath $logDir -Force -ErrorAction Stop | Out-Null
    }
    $timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    $logFile = Join-Path $logDir ("{0}-{1}.log" -f $Name, $timestamp)
    $script:EpmLogFile = $logFile

    # 過去ログを最新30件にローテーション
    $oldLogs = Get-ChildItem -LiteralPath $logDir -Filter "$Name-*.log" -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip 30
    if ($oldLogs) {
        foreach ($old in $oldLogs) {
            Remove-Item -LiteralPath $old.FullName -Force -ErrorAction SilentlyContinue
        }
    }

    Write-EpmLog -Level INFO -Message ("ログファイル初期化: {0}" -f $logFile)
    return $logFile
}

function Write-EpmLog {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('INFO', 'OK', 'WARN', 'ERR', 'STEP')][string]$Level,
        [Parameter(Mandatory = $true)][string]$Message
    )
    $timeStr = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $formatted = "[{0}] [{1}] {2}" -f $timeStr, $Level, $Message

    $color = 'Gray'
    switch ($Level) {
        'STEP' { $color = 'Cyan' }
        'OK'   { $color = 'Green' }
        'WARN' { $color = 'Yellow' }
        'ERR'  { $color = 'Red' }
        'INFO' { $color = 'Gray' }
    }

    Write-Host $formatted -ForegroundColor $color

    if ($script:EpmLogFile) {
        Add-Content -LiteralPath $script:EpmLogFile -Value $formatted -Encoding UTF8 -ErrorAction SilentlyContinue
    }
}

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [string]$WorkingDirectory = $script:RepoRoot,
        [switch]$AllowFailure
    )
    Write-EpmLog -Level INFO -Message ("> {0} {1}  (in {2})" -f $FilePath, ($ArgumentList -join ' '), $WorkingDirectory)
    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    Push-Location -LiteralPath $WorkingDirectory
    try {
        & $FilePath @ArgumentList 2>&1 | ForEach-Object {
            $line = "$_"
            Write-Host $line
            if ($script:EpmLogFile) { Add-Content -LiteralPath $script:EpmLogFile -Value $line -Encoding UTF8 }
        }
        $code = $LASTEXITCODE
    } finally {
        Pop-Location
        $ErrorActionPreference = $prevPref
    }
    if ($null -eq $code) { $code = 0 }
    if ($code -ne 0 -and -not $AllowFailure) {
        throw ("{0} {1} が失敗しました (exit {2})" -f $FilePath, ($ArgumentList -join ' '), $code)
    }
    return $code
}

function Get-GitOutput {
    param(
        [Parameter(Mandatory = $true)][string[]]$ArgumentList,
        [string]$WorkingDirectory = $script:RepoRoot
    )
    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    Push-Location -LiteralPath $WorkingDirectory
    try {
        $output = & git @ArgumentList 2>$null
        $code = $LASTEXITCODE
    } finally {
        Pop-Location
        $ErrorActionPreference = $prevPref
    }
    if ($code -ne 0) {
        throw ("git {0} が失敗しました (exit {1})" -f ($ArgumentList -join ' '), $code)
    }
    if ($null -eq $output) { return ,@() }
    return ,([string[]]$output)
}

function Get-RepoRoot {
    if (Test-Path (Join-Path $PSScriptRoot '..\..\ecosystem.config.js')) {
        return (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    }
    return (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

function Read-DotEnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Key
    )
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    foreach ($line in (Get-Content -LiteralPath $Path)) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        if ($trimmed -match "^$Key\s*=\s*(.*)$") {
            $val = $matches[1].Trim()
            if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
                if ($val.Length -ge 2) {
                    $val = $val.Substring(1, $val.Length - 2)
                }
            }
            return $val
        }
    }
    return $null
}

function Get-EpmPaths {
    param([Parameter(Mandatory = $true)][string]$RepoRoot)
    $serverDir = Join-Path $RepoRoot 'server'
    $clientDir = Join-Path $RepoRoot 'client'
    $envPath = Join-Path $serverDir '.env'

    # DB_PATH 解決 (D8)
    $dbEnv = Read-DotEnvValue -Path $envPath -Key 'DB_PATH'
    if ($dbEnv) {
        if ([System.IO.Path]::IsPathRooted($dbEnv)) {
            $dbPath = $dbEnv
        } else {
            $dbPath = [System.IO.Path]::GetFullPath((Join-Path $serverDir $dbEnv))
        }
    } else {
        $dbPath = Join-Path $serverDir 'database.sqlite'
    }

    # UPLOAD_DIR 解決 (D9)
    $uploadEnv = Read-DotEnvValue -Path $envPath -Key 'UPLOAD_DIR'
    if ($uploadEnv) {
        if ([System.IO.Path]::IsPathRooted($uploadEnv)) {
            $uploadDir = $uploadEnv
        } else {
            $uploadDir = [System.IO.Path]::GetFullPath((Join-Path $serverDir $uploadEnv))
        }
    } else {
        $uploadDir = Join-Path $RepoRoot 'uploads'
    }

    # API PORT
    $portEnv = Read-DotEnvValue -Path $envPath -Key 'PORT'
    $apiPort = 3001
    if ($portEnv -and ($portEnv -match '^\d+$')) {
        $apiPort = [int]$portEnv
    }

    return [pscustomobject]@{
        ServerDir  = $serverDir
        ClientDir  = $clientDir
        DbPath     = $dbPath
        UploadDir  = $uploadDir
        ApiPort    = $apiPort
        WebPort    = 5173
        Ecosystem  = (Join-Path $RepoRoot 'ecosystem.config.js')
        BackupDir  = (Join-Path $serverDir 'backups\db')
    }
}

function Test-NodeVersion {
    try {
        $verStr = (node -p "process.versions.node").Trim()
        if ($verStr -match '^(\d+)\.') {
            $major = [int]$matches[1]
            if ($major -ge 18 -and $major -le 22) {
                Write-EpmLog -Level OK -Message ("Node.js バージョン正常: v{0}" -f $verStr)
                return $true
            } else {
                Write-EpmLog -Level ERR -Message ("Node.js のバージョンが無効です: v{0} (18〜22 が必要です)" -f $verStr)
                return $false
            }
        }
    } catch {
        Write-EpmLog -Level ERR -Message ("Node.js バージョン確認に失敗しました: {0}" -f $_.Exception.Message)
        return $false
    }
    Write-EpmLog -Level ERR -Message "Node.js バージョンを取得できませんでした"
    return $false
}

function Test-Prerequisites {
    $commands = @('git', 'node', 'npm', 'pm2')
    $allOk = $true
    foreach ($cmd in $commands) {
        $found = Get-Command $cmd -ErrorAction SilentlyContinue
        if (-not $found) {
            $allOk = $false
            if ($cmd -eq 'pm2') {
                Write-EpmLog -Level ERR -Message "pm2 が見つかりません。'npm install -g pm2' でインストールしてください。"
            } else {
                Write-EpmLog -Level ERR -Message ("必要なコマンドが見つかりません: {0}" -f $cmd)
            }
        }
    }
    return $allOk
}

function Get-Pm2Apps {
    try {
        $prevPref = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $jlistOutput = pm2 jlist 2>$null
        $ErrorActionPreference = $prevPref
        if (-not $jlistOutput) { return @() }
        $jsonLine = $jlistOutput | Where-Object { $_ -match '^\s*\[\s*(\{|\])' } | Select-Object -Last 1
        if (-not $jsonLine) { return @() }
        $parsed = $jsonLine | ConvertFrom-Json
        $result = @()
        foreach ($app in $parsed) {
            $result += [pscustomobject]@{
                name   = $app.name
                status = $app.pm2_env.status
            }
        }
        return $result
    } catch {
        return @()
    }
}

function Stop-EpmApps {
    param([Parameter(Mandatory = $true)][string]$Ecosystem)
    Write-EpmLog -Level STEP -Message "PM2 アプリケーションを停止中..."
    $null = Invoke-Native -FilePath 'pm2' -ArgumentList @('stop', $Ecosystem)
}

function Start-EpmApps {
    param([Parameter(Mandatory = $true)][string]$Ecosystem)
    Write-EpmLog -Level STEP -Message "PM2 アプリケーションを起動/再起動中..."
    $null = Invoke-Native -FilePath 'pm2' -ArgumentList @('startOrRestart', $Ecosystem, '--update-env')
}

function Wait-EpmHealthy {
    param(
        [Parameter(Mandatory = $true)]$Paths,
        [int]$TimeoutSec = 60
    )
    Write-EpmLog -Level STEP -Message ("ヘルスチェック待機中 (最大 {0} 秒)..." -f $TimeoutSec)
    $startTime = [System.DateTime]::UtcNow
    $apiOk = $false
    $pm2Ok = $false
    $webOk = $false

    while (([System.DateTime]::UtcNow - $startTime).TotalSeconds -lt $TimeoutSec) {
        # (a) API ヘルスチェック
        try {
            $healthUrl = ("http://127.0.0.1:{0}/api/health" -f $Paths.ApiPort)
            $res = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3 -ErrorAction Stop
            $apiOk = ($res.status -eq 'ok')
        } catch {
            $apiOk = $false
        }

        # (b) PM2 online 確認
        $apps = Get-Pm2Apps
        $serverApp = $apps | Where-Object { $_.name -eq 'epm-server' }
        $webApp = $apps | Where-Object { $_.name -eq 'epm-web' }
        $pm2Ok = ($null -ne $serverApp -and $serverApp.status -eq 'online' -and $null -ne $webApp -and $webApp.status -eq 'online')

        # (c) Webポート (5173) 接続確認
        $webOk = $false
        $tcp = New-Object System.Net.Sockets.TcpClient
        try {
            $ar = $tcp.BeginConnect('127.0.0.1', $Paths.WebPort, $null, $null)
            $wait = $ar.AsyncWaitHandle.WaitOne(1000, $false)
            if ($wait -and $tcp.Connected) {
                $tcp.EndConnect($ar)
                $webOk = $true
            }
        } catch {
            $webOk = $false
        } finally {
            $tcp.Close()
        }

        if ($apiOk -and $pm2Ok -and $webOk) {
            Write-EpmLog -Level OK -Message "ヘルスチェック成功: 全サービス正常稼働"
            return $true
        }

        Start-Sleep -Seconds 1
    }

    Write-EpmLog -Level ERR -Message ("ヘルスチェックタイムアウト: API={0}, PM2={1}, WebPort={2}" -f $apiOk, $pm2Ok, $webOk)
    return $false
}

function Test-PortFree {
    param([Parameter(Mandatory = $true)][int]$Port)
    $tcp = New-Object System.Net.Sockets.TcpClient
    try {
        $ar = $tcp.BeginConnect('127.0.0.1', $Port, $null, $null)
        $wait = $ar.AsyncWaitHandle.WaitOne(1000, $false)
        if ($wait -and $tcp.Connected) {
            $tcp.EndConnect($ar)
            return $false
        }
        return $true
    } catch {
        return $true
    } finally {
        $tcp.Close()
    }
}

function Get-FileCountSafe {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return 0 }
    $files = Get-ChildItem -LiteralPath $Path -Recurse -File -ErrorAction SilentlyContinue
    if ($null -eq $files) { return 0 }
    return $files.Count
}

function Invoke-ClientBuild {
    param([Parameter(Mandatory = $true)][string]$ClientDir)
    Write-EpmLog -Level STEP -Message "クライアントをビルド中 (dist.next)..."
    $nextDir = Join-Path $ClientDir 'dist.next'
    if (Test-Path -LiteralPath $nextDir) {
        Remove-Item -LiteralPath $nextDir -Recurse -Force -ErrorAction Stop
    }
    $null = Invoke-Native -FilePath 'npm' -ArgumentList @('run', 'build', '--', '--outDir', 'dist.next', '--emptyOutDir') -WorkingDirectory $ClientDir
    $indexHtml = Join-Path $nextDir 'index.html'
    $swJs = Join-Path $nextDir 'sw.js'
    if (-not (Test-Path -LiteralPath $indexHtml) -or -not (Test-Path -LiteralPath $swJs)) {
        throw "ビルド検証失敗: dist.next/index.html または dist.next/sw.js が存在しません"
    }
    Write-EpmLog -Level OK -Message "クライアントビルド成功 (dist.next 検証完了)"
}

function Switch-ClientDist {
    param([Parameter(Mandatory = $true)][string]$ClientDir)
    Write-EpmLog -Level STEP -Message "dist ディレクトリの安全な入れ替えを実行中..."
    $distDir = Join-Path $ClientDir 'dist'
    $prevDir = Join-Path $ClientDir 'dist.prev'
    $nextDir = Join-Path $ClientDir 'dist.next'

    if (-not (Test-Path -LiteralPath $nextDir)) {
        throw "入れ替え対象の dist.next が存在しません"
    }

    # リトライ処理
    $retryAction = {
        param([scriptblock]$action, [string]$opName)
        $attempts = 0
        while ($attempts -lt 3) {
            try {
                & $action
                return
            } catch {
                $attempts++
                if ($attempts -ge 3) { throw }
                Start-Sleep -Seconds 2
            }
        }
    }

    # 1. 既存の dist.prev を削除
    if (Test-Path -LiteralPath $prevDir) {
        & $retryAction { Remove-Item -LiteralPath $prevDir -Recurse -Force -ErrorAction Stop } "dist.prev の削除"
    }

    # 2. dist -> dist.prev へリネーム
    if (Test-Path -LiteralPath $distDir) {
        & $retryAction { Rename-Item -LiteralPath $distDir -NewName 'dist.prev' -ErrorAction Stop } "dist -> dist.prev へのリネーム"
    }

    # 3. dist.next -> dist へリネーム
    & $retryAction { Rename-Item -LiteralPath $nextDir -NewName 'dist' -ErrorAction Stop } "dist.next -> dist へのリネーム"

    Write-EpmLog -Level OK -Message "dist ディレクトリの入れ替え完了"
    return $true
}

function Restore-ClientDist {
    param([Parameter(Mandatory = $true)][string]$ClientDir)
    Write-EpmLog -Level WARN -Message "dist ディレクトリを dist.prev から復元中..."
    $distDir = Join-Path $ClientDir 'dist'
    $prevDir = Join-Path $ClientDir 'dist.prev'

    if (Test-Path -LiteralPath $prevDir) {
        if (Test-Path -LiteralPath $distDir) {
            Remove-Item -LiteralPath $distDir -Recurse -Force -ErrorAction Stop
        }
        Rename-Item -LiteralPath $prevDir -NewName 'dist' -ErrorAction Stop
        Write-EpmLog -Level OK -Message "dist ディレクトリの復元完了"
    } else {
        Write-EpmLog -Level WARN -Message "復元用の dist.prev が存在しません"
    }
}

function Remove-OldDbBackups {
    param(
        [Parameter(Mandatory = $true)][string]$BackupDir,
        [int]$Keep = 20
    )
    if (-not (Test-Path -LiteralPath $BackupDir)) { return }
    $allFiles = Get-ChildItem -LiteralPath $BackupDir -File -ErrorAction SilentlyContinue
    if ($null -eq $allFiles) { return }

    # バックアップ削除の正規表現: database-\d{8}_\d{6}\.sqlite(-journal|-wal|-shm)?
    # database-YYYYMMDD_HHmmss.sqlite* のみを対象
    $backupGroups = $allFiles | Where-Object { $_.Name -match '^database-(\d{8}_\d{6})\.sqlite(-journal|-wal|-shm)?$' } | Group-Object {
        if ($_.Name -match '^database-(\d{8}_\d{6})\.sqlite') { $matches[1] } else { $_.Name }
    }

    $sortedGroups = $backupGroups | Sort-Object Name -Descending
    $excessGroups = $sortedGroups | Select-Object -Skip $Keep

    foreach ($group in $excessGroups) {
        foreach ($file in $group.Group) {
            Write-EpmLog -Level INFO -Message ("古いバックアップを削除: {0}" -f $file.Name)
            Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue
        }
    }
}
