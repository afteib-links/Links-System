[CmdletBinding()]
param(
    [switch]$DryRun,
    [ValidateRange(1, 3600)][int]$TimeoutSeconds = 180,
    [string]$EnvFile = 'tmp/test-tool.env'
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedEnv = [IO.Path]::GetFullPath((Join-Path $repoRoot $EnvFile))
if (-not $DryRun -and -not (Test-Path -LiteralPath $resolvedEnv -PathType Leaf)) {
    throw 'Create the dedicated test-tool environment file before deployment.'
}
# Compose accepts these environment variables. The shared updater remains the
# sole implementation of config validation, rebuild, startup and health checks.
$keys = @('COMPOSE_FILE', 'COMPOSE_ENV_FILES', 'COMPOSE_PROJECT_NAME', 'COMPOSE_PROFILES', 'COMPOSE_DISABLE_ENV_FILE', 'TEST_TOOL_BIND_IP', 'TEST_TOOL_PORT')
$previous = @{}
foreach ($key in $keys) { $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
try {
    $env:COMPOSE_FILE = Join-Path $repoRoot 'docker-compose.test-data.yml'
    $env:COMPOSE_ENV_FILES = $resolvedEnv
    $env:COMPOSE_PROJECT_NAME = 'links-test-data-tool'
    $env:COMPOSE_PROFILES = ''
    $env:COMPOSE_DISABLE_ENV_FILE = 'true'
    $env:TEST_TOOL_BIND_IP = '127.0.0.1'
    $env:TEST_TOOL_PORT = '8088'
    # Invoke in a child process because the shared updater uses exit.
    $arguments = @('-NoProfile', '-File', (Join-Path $PSScriptRoot 'docker-update.ps1'), '-HealthUrl', 'http://127.0.0.1:8088/api/health', '-TimeoutSeconds', $TimeoutSeconds)
    if ($DryRun) { $arguments += '-DryRun' }
    & (Join-Path $PSHOME 'pwsh.exe') @arguments
    if ($LASTEXITCODE -ne 0) { throw "Dedicated Docker update failed ($LASTEXITCODE)." }
} finally {
    foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
}
