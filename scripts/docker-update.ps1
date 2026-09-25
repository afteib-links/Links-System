[CmdletBinding()]
param(
    [switch]$DryRun,
    [ValidateRange(1, 3600)]
    [int]$TimeoutSeconds = 120,
    [string[]]$HealthUrl = @(
        "http://127.0.0.1:8080/api/health",
        "http://127.0.0.1:3000/api/health"
    )
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptRoot

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot "docker-compose.yml") -PathType Leaf)) {
    throw "docker-compose.yml not found: $repoRoot"
}

$dataRoot = $env:LINKS_DATA_ROOT
if ([string]::IsNullOrWhiteSpace($dataRoot)) {
    $dataRoot = $repoRoot
    if (Get-Command git -ErrorAction SilentlyContinue) {
        $gitCommonDirOutput = @(& git -C $repoRoot rev-parse --path-format=absolute --git-common-dir 2>$null)
        if ($LASTEXITCODE -eq 0 -and $gitCommonDirOutput.Count -gt 0) {
            $gitCommonDir = [string]$gitCommonDirOutput[0]
            if ((Split-Path -Leaf $gitCommonDir) -eq ".git") {
                $candidateRoot = Split-Path -Parent $gitCommonDir
                if (Test-Path -LiteralPath $candidateRoot -PathType Container) {
                    $dataRoot = $candidateRoot
                }
            }
        }
    }
    $env:LINKS_DATA_ROOT = $dataRoot
}

function Format-Command {
    param([string]$Command, [string[]]$Arguments)
    return (($Command) + " " + (($Arguments | ForEach-Object {
        if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
    }) -join " ")).Trim()
}

function Invoke-CheckedCommand {
    param([string]$Command, [string[]]$Arguments)
    Write-Host ("  " + (Format-Command -Command $Command -Arguments $Arguments))
    if ($DryRun) { return }
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE"
    }
}

Write-Host "Links-System Docker update"
Write-Host "  mode: local"
Write-Host "  root: $repoRoot"
Write-Host "  data root: $dataRoot"
Write-Host "  dry-run: $DryRun"

Push-Location -LiteralPath $repoRoot
try {
    if (-not $DryRun -and -not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "docker command not found"
    }

    if (-not $DryRun) {
        Invoke-CheckedCommand -Command "docker" -Arguments @("compose", "version")
    }
    Invoke-CheckedCommand -Command "docker" -Arguments @("compose", "config", "--quiet")
    Invoke-CheckedCommand -Command "docker" -Arguments @("compose", "up", "--build", "-d")
    Invoke-CheckedCommand -Command "docker" -Arguments @("compose", "ps")

    if ($DryRun) {
        Write-Host "  health: poll $($HealthUrl -join ', ') until db=up ($($TimeoutSeconds)s)"
        Write-Host "Dry-run completed. No Docker or database state was changed."
        exit 0
    }

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        foreach ($url in $HealthUrl) {
            try {
                $health = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 5
                if ($health.db -eq "up") {
                    Write-Host "Docker update completed: $url reports db=up"
                    exit 0
                }
            } catch {
                # Containers may still be starting; retry until the deadline.
            }
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)

    Write-Host "Docker update failed: health check did not report db=up within $($TimeoutSeconds)s." -ForegroundColor Red
    & docker compose ps
    & docker compose logs app --tail 100
    exit 1
} finally {
    Pop-Location
}
