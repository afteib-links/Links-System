[CmdletBinding()]
param(
    [switch]$DryRun,
    [ValidateRange(1, 3600)]
    [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$updater = Join-Path $scriptRoot "docker-update.ps1"

function ConvertFrom-Utf8Base64 {
    param([string]$Value)
    return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Value))
}

Write-Host "============================================================"
Write-Host (ConvertFrom-Utf8Base64 "TGlua3MtU3lzdGVtIERvY2tlcuabtOaWsA==")
Write-Host "============================================================"
Write-Host (ConvertFrom-Utf8Base64 "RG9ja2Vy44Gu5YaN44OT44Or44OJ44CB6LW35YuV44CB44OH44O844K/44OZ44O844K55o6l57aa56K66KqN44KS6KGM44GE44G+44GZ44CC")
Write-Host (ConvertFrom-Utf8Base64 "44OH44O844K/44OZ44O844K544Gu44OH44O844K/44KERG9ja2Vy44Oc44Oq44Ol44O844Og44Gv5YmK6Zmk44GX44G+44Gb44KT44CC")
Write-Host ""

$arguments = @(
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $updater,
    "-TimeoutSeconds", $TimeoutSeconds
)
if ($DryRun) {
    $arguments += "-DryRun"
}

& powershell.exe @arguments
$updateResult = $LASTEXITCODE

Write-Host ""
if ($updateResult -eq 0) {
    Write-Host (ConvertFrom-Utf8Base64 "W+ato+W4uOe1guS6hl0gRG9ja2Vy5pu05paw44Go44OY44Or44K544OB44Kn44OD44Kv44GM5a6M5LqG44GX44G+44GX44Gf44CC") -ForegroundColor Green
    Write-Host (ConvertFrom-Utf8Base64 "44K344K544OG44OgVVJMOiBodHRwOi8vMTI3LjAuMC4xOjgwODA=")
} else {
    Write-Host (ConvertFrom-Utf8Base64 "W+WkseaVl10gRG9ja2Vy5pu05paw44G+44Gf44Gv44OY44Or44K544OB44Kn44OD44Kv44Gr5aSx5pWX44GX44G+44GX44Gf44CC") -ForegroundColor Red
    Write-Host ((ConvertFrom-Utf8Base64 "57WC5LqG44Kz44O844OJOiA=") + $updateResult)
    Write-Host (ConvertFrom-Utf8Base64 "5LiK44Gr6KGo56S644GV44KM44Gf44Ko44Op44O85YaF5a6544KS56K66KqN44GX44Gm44GP44Gg44GV44GE44CC")
}
Write-Host ""

if ($env:LINKS_DOCKER_UPDATE_NO_PAUSE -ne "1") {
    Read-Host (ConvertFrom-Utf8Base64 "RW50ZXLjgq3jg7zjgpLmirzjgZnjgajplonjgZjjgb7jgZk=")
}
exit $updateResult
