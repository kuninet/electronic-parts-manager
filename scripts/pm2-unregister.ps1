# Electronic Parts Manager - PM2 常駐登録解除
# PS 5.1 / PS 7 両対応 (UTF-8 BOM / CRLF)

[CmdletBinding()]
param(
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. (Join-Path $PSScriptRoot 'lib\epm-common.ps1')
$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $script:RepoRoot

$logPath = Initialize-EpmLog -Name 'unregister'
Write-EpmLog -Level STEP -Message "=== Electronic Parts Manager PM2 サービス解除 ==="

if (-not $Yes) {
    Write-Host "PM2 から EPM を削除し、自動起動を解除します。DB と画像は削除されません。" -ForegroundColor Yellow
    $ans = Read-Host "解除を続行しますか？ (y/N)"
    if ($ans -ne 'y' -and $ans -ne 'Y') {
        Write-EpmLog -Level INFO -Message "解除処理がキャンセルされました。"
        exit 0
    }
}

$paths = Get-EpmPaths -RepoRoot $script:RepoRoot

# 1. PM2 からプロセス削除
Write-EpmLog -Level STEP -Message "PM2 から EPM アプリケーションを削除中..."
$null = Invoke-Native -FilePath 'pm2' -ArgumentList @('delete', $paths.Ecosystem) -AllowFailure

# 2. PM2 状態を強制保存
Write-EpmLog -Level STEP -Message "PM2 の最新状態を保存中 (pm2 save --force)..."
$null = Invoke-Native -FilePath 'pm2' -ArgumentList @('save', '--force') -AllowFailure

# 3. スタートアップショートカット削除
try {
    $startup = [Environment]::GetFolderPath('Startup')
    $lnkPath = Join-Path $startup 'EPM - pm2 resurrect.lnk'
    if (Test-Path -LiteralPath $lnkPath) {
        Remove-Item -LiteralPath $lnkPath -Force -ErrorAction Stop
        Write-EpmLog -Level OK -Message ("スタートアップショートカットを削除しました: {0}" -f $lnkPath)
    }
} catch {
    Write-EpmLog -Level WARN -Message ("スタートアップショートカットの削除に失敗しました: {0}" -f $_.Exception.Message)
}

Write-EpmLog -Level OK -Message "EPM の常駐解除が完了しました。"
Write-EpmLog -Level INFO -Message "※ pm2 本体および pm2-logrotate は他アプリケーション共用のためアンインストールしていません。"
Write-EpmLog -Level INFO -Message "  完全に削除したい場合は 'npm uninstall -g pm2' を手動実行してください。"

exit 0
