[CmdletBinding()]
param(
    [string]$NasHost,
    [string]$SshUser,
    [int]$SshPort = 0,
    [string]$IdentityFile,
    [string]$ProjectPath,
    [ValidateSet("yes", "no")][string]$SystemBackup,
    [ValidateSet("yes", "no")][string]$DatabaseBackup,
    [ValidateSet("update", "replace")][string]$DatabaseMode,
    [ValidateSet("yes", "no")][string]$Files,
    [ValidateSet("yes", "no")][string]$RotateWeakSecrets,
    [string]$Reason = "",
    [switch]$NonInteractive,
    [switch]$DryRun,
    [switch]$ResetFailureCount
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptRoot
$stateDir = Join-Path $repoRoot "tmp"
$failureFile = Join-Path $stateDir "production-deploy-failures.txt"
$profileFile = Join-Path $scriptRoot "production-deploy.local.json"
$maxFailures = 3

function Read-Choice([string]$Prompt, [string[]]$Allowed, [string]$Default) {
    $value = Read-Host "$Prompt [$Default]"
    if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
    $value = $value.Trim().ToLowerInvariant()
    if ($Allowed -notcontains $value) { throw "選択値が不正です: $value" }
    return $value
}

function Read-WithDefault([string]$Prompt, [string]$Default) {
    $suffix = if ([string]::IsNullOrWhiteSpace($Default)) { "" } else { " [$Default]" }
    $value = Read-Host "$Prompt$suffix"
    if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
    return $value.Trim()
}

function Invoke-External([string]$Command, [string[]]$Arguments) {
    Write-Host ("  > " + $Command + " " + ($Arguments -join " "))
    if ($DryRun) { return }
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command が終了コード $LASTEXITCODE で失敗しました。" }
}

function Get-FailureCount {
    if (-not (Test-Path -LiteralPath $failureFile)) { return 0 }
    $raw = (Get-Content -LiteralPath $failureFile -Raw).Trim()
    if ($raw -match '^\d+$') { return [int]$raw }
    return 0
}

function Set-FailureCount([int]$Count) {
    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
    Set-Content -LiteralPath $failureFile -Value $Count -Encoding ascii
}

if ($ResetFailureCount) { Set-FailureCount 0 }
$failureCount = Get-FailureCount
if ($failureCount -ge $maxFailures) {
    throw "本番移行が3回連続で失敗したため停止中です。原因確認後、-ResetFailureCount を指定して再開してください。"
}

$savedProfile = $null
if (Test-Path -LiteralPath $profileFile) {
    try { $savedProfile = Get-Content -LiteralPath $profileFile -Raw | ConvertFrom-Json } catch {
        throw "接続設定を読めません: $profileFile"
    }
}
if (-not $PSBoundParameters.ContainsKey("NasHost") -and $savedProfile.NasHost) { $NasHost = [string]$savedProfile.NasHost }
if (-not $PSBoundParameters.ContainsKey("SshUser") -and $savedProfile.SshUser) { $SshUser = [string]$savedProfile.SshUser }
if (-not $PSBoundParameters.ContainsKey("SshPort") -and $savedProfile.SshPort) { $SshPort = [int]$savedProfile.SshPort }
if (-not $PSBoundParameters.ContainsKey("IdentityFile") -and $savedProfile.IdentityFile) { $IdentityFile = [string]$savedProfile.IdentityFile }
if (-not $PSBoundParameters.ContainsKey("ProjectPath") -and $savedProfile.ProjectPath) { $ProjectPath = [string]$savedProfile.ProjectPath }
if ([string]::IsNullOrWhiteSpace($SshUser)) { $SshUser = "admin" }
if ($SshPort -eq 0) { $SshPort = 22 }
if ([string]::IsNullOrWhiteSpace($IdentityFile)) {
    $defaultIdentity = Join-Path $env:USERPROFILE ".ssh\links_system_production_ed25519"
    if (Test-Path -LiteralPath $defaultIdentity) { $IdentityFile = $defaultIdentity }
}
if ([string]::IsNullOrWhiteSpace($ProjectPath)) { $ProjectPath = "/share/Container/Links-System" }

if (-not $NonInteractive) {
    $NasHost = Read-WithDefault "本番QNAPのホスト名またはIPアドレス" $NasHost
    $SshUser = Read-WithDefault "SSHユーザー" $SshUser
    $portText = Read-WithDefault "SSHポート" ([string]$SshPort)
    if ($portText -notmatch '^\d+$') { throw "SSHポートが不正です: $portText" }
    $SshPort = [int]$portText
    $IdentityFile = Read-WithDefault "SSH秘密鍵（パスワード認証なら空欄）" $IdentityFile
    $ProjectPath = Read-WithDefault "QNAP上の配置先" $ProjectPath
    if ([string]::IsNullOrWhiteSpace($SystemBackup)) { $SystemBackup = Read-Choice "システムを反映前にバックアップしますか？ yes/no" @("yes", "no") "yes" }
    if ([string]::IsNullOrWhiteSpace($DatabaseBackup)) { $DatabaseBackup = Read-Choice "本番DBを変更前にバックアップしますか？ yes/no" @("yes", "no") "yes" }
    if ([string]::IsNullOrWhiteSpace($DatabaseMode)) { $DatabaseMode = Read-Choice "DB処理: update=既存データ保持 / replace=ローカルDBへ差し替え" @("update", "replace") "update" }
    if ([string]::IsNullOrWhiteSpace($Files)) { $Files = Read-Choice "添付・PDFファイルを更新しますか？ yes/no" @("yes", "no") "no" }
    if ([string]::IsNullOrWhiteSpace($RotateWeakSecrets)) { $RotateWeakSecrets = Read-Choice "初期値のDB内部資格情報とセッション秘密鍵を安全な値へ更新しますか？ yes/no（adminパスワードは変更しません）" @("yes", "no") "yes" }
    if ([string]::IsNullOrWhiteSpace($Reason)) { $Reason = Read-Host "実行理由・メモ（任意）" }
}

if ([string]::IsNullOrWhiteSpace($NasHost)) { throw "-NasHost が必要です。" }
if ([string]::IsNullOrWhiteSpace($SshUser)) { throw "-SshUser が必要です。" }
if ($SshPort -lt 1 -or $SshPort -gt 65535) { throw "SshPort は1～65535で指定してください。" }
if (-not $DryRun -and -not [string]::IsNullOrWhiteSpace($IdentityFile) -and -not (Test-Path -LiteralPath $IdentityFile -PathType Leaf)) {
    throw "SSH秘密鍵が見つかりません: $IdentityFile"
}
if ([string]::IsNullOrWhiteSpace($SystemBackup) -or [string]::IsNullOrWhiteSpace($DatabaseBackup) -or
    [string]::IsNullOrWhiteSpace($DatabaseMode) -or [string]::IsNullOrWhiteSpace($Files) -or
    [string]::IsNullOrWhiteSpace($RotateWeakSecrets)) {
    throw "NonInteractiveでは SystemBackup / DatabaseBackup / DatabaseMode / Files / RotateWeakSecrets をすべて指定してください。"
}
if ($ProjectPath -notmatch '^/share/[A-Za-z0-9._/-]*/Links-System$' -or $ProjectPath -match '/\.\.?/') {
    throw "ProjectPath が許可範囲外です: $ProjectPath"
}

$required = @("git", "ssh", "scp", "tar")
foreach ($name in $required) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw "$name コマンドが見つかりません。" }
}
$bashCandidates = @("$env:ProgramFiles\Git\bin\bash.exe", "${env:ProgramFiles(x86)}\Git\bin\bash.exe")
$bashExe = $bashCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $bashExe) {
    $bashCommand = Get-Command bash -ErrorAction SilentlyContinue
    if ($bashCommand) { $bashExe = $bashCommand.Source }
}
if (-not $bashExe) { throw "Git Bashが見つかりません。" }

$deploymentId = Get-Date -Format "yyyyMMdd_HHmmss"
$workDir = Join-Path $stateDir "links-production-deploy-$deploymentId"
$projectParent = $ProjectPath.Substring(0, $ProjectPath.LastIndexOf('/'))
$remoteDir = "$projectParent/links-production-deploy-$deploymentId"
$systemArchive = Join-Path $workDir "system.tgz"
$filesArchive = Join-Path $workDir "files.tgz"
$remoteHelper = Join-Path $scriptRoot "production-deploy-remote.sh"
$localAppStopped = $false
$reasonBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Reason))

Write-Host "Links-System 本番移行"
Write-Host "  接続先: $SshUser@$NasHost`:$SshPort"
Write-Host "  本番パス: $ProjectPath"
Write-Host "  システムバックアップ: $SystemBackup"
Write-Host "  DBバックアップ: $DatabaseBackup"
Write-Host "  DB処理: $DatabaseMode"
Write-Host "  ファイル更新: $Files"
Write-Host "  初期秘密値の更新: $RotateWeakSecrets（adminパスワードは対象外）"
Write-Host "  理由: $Reason"
Write-Host "  連続失敗回数: $failureCount / $maxFailures"

if (-not $NonInteractive) {
    $confirm = Read-Host "上記内容で本番へ反映しますか？ yes/no [no]"
    if ($confirm.Trim().ToLowerInvariant() -ne "yes") { Write-Host "中止しました。"; exit 0 }
}

if (-not $DryRun) {
    @{
        NasHost = $NasHost
        SshUser = $SshUser
        SshPort = $SshPort
        IdentityFile = $IdentityFile
        ProjectPath = $ProjectPath
    } | ConvertTo-Json | Set-Content -LiteralPath $profileFile -Encoding utf8
}

try {
    if (-not $DryRun) { New-Item -ItemType Directory -Force -Path $workDir | Out-Null }
    Push-Location -LiteralPath $repoRoot
    try {
        Invoke-External $bashExe @("scripts/create-production-system-archive.sh", $systemArchive)
        if ($Files -eq "yes") {
            $fileItems = @()
            if (Test-Path -LiteralPath "data/uploads") { $fileItems += "data/uploads" }
            if (Test-Path -LiteralPath "data/pdf") { $fileItems += "data/pdf" }
            if ($fileItems.Count -eq 0) { throw "更新対象の data/uploads または data/pdf がありません。" }
            Invoke-External "tar" (@("-czf", $filesArchive) + $fileItems)
        }

        if ($DatabaseMode -eq "replace") {
            if (-not $DryRun) {
                $docker = Get-Command docker -ErrorAction SilentlyContinue
                if (-not $docker) { throw "DB差し替えには起動中のローカルDockerが必要です。" }
                Invoke-External "docker" @("compose", "stop", "app")
                $localAppStopped = $true
                Invoke-External $bashExe @("scripts/nas-db-export.sh", ($workDir -replace '\\', '/'))
                Invoke-External "docker" @("compose", "start", "app")
                $localAppStopped = $false
                $dump = Get-ChildItem -LiteralPath $workDir -Filter "links_*.sql" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
                if (-not $dump) { throw "ローカルDBダンプが作成されませんでした。" }
                $manifest = [IO.Path]::ChangeExtension($dump.FullName, ".manifest")
                if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { throw "ローカルDBマニフェストが作成されませんでした。" }
            } else {
                Invoke-External "docker" @("compose", "stop", "app")
                Invoke-External $bashExe @("scripts/nas-db-export.sh", ($workDir -replace '\\', '/'))
                Invoke-External "docker" @("compose", "start", "app")
            }
        }
    } finally {
        Pop-Location
    }

    if (-not $DryRun) { Copy-Item -LiteralPath $remoteHelper -Destination (Join-Path $workDir "production-deploy-remote.sh") }
    $sshBase = @("-p", "$SshPort", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new")
    if (-not [string]::IsNullOrWhiteSpace($IdentityFile)) { $sshBase += @("-i", $IdentityFile) }
    if ($NonInteractive) { $sshBase += @("-o", "BatchMode=yes") }
    $target = "$SshUser@$NasHost"
    $scpArgs = @("-r", "-P", "$SshPort", "-o", "StrictHostKeyChecking=accept-new")
    if (-not [string]::IsNullOrWhiteSpace($IdentityFile)) { $scpArgs += @("-i", $IdentityFile) }
    if ($NonInteractive) { $scpArgs += @("-o", "BatchMode=yes") }
    Invoke-External "scp" ($scpArgs + @($workDir, "${target}:$projectParent/"))
    $remoteCommand = "bash '$remoteDir/production-deploy-remote.sh' '$ProjectPath' '$remoteDir' '$SystemBackup' '$DatabaseBackup' '$DatabaseMode' '$Files' '$deploymentId' '$RotateWeakSecrets' '$reasonBase64'"
    Invoke-External "ssh" ($sshBase + @($target, $remoteCommand))

    if ($DryRun) {
        Write-Host "ドライラン完了: 本番環境は変更していません。"
    } else {
        Set-FailureCount 0
        Write-Host "本番移行成功: http://$NasHost`:8080/api/health"
    }
} catch {
    if ($localAppStopped) {
        try { & docker compose start app | Out-Host } catch { Write-Warning "ローカルappの再開にも失敗しました。" }
    }
    if (-not $DryRun) {
        $failureCount++
        Set-FailureCount $failureCount
    }
    Write-Error "本番移行失敗 ($failureCount / $maxFailures): $($_.Exception.Message)"
    if ($failureCount -ge $maxFailures) { Write-Error "3回連続失敗したため停止します。原因確認後に再開してください。" }
    exit 1
} finally {
    if (-not $DryRun -and (Test-Path -LiteralPath $workDir)) {
        Remove-Item -LiteralPath $workDir -Recurse -Force
    }
}
