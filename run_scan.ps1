<#
    Daily NSE swing-scan runner, for THIS machine.

    Mirrors the pattern of Gold\run_daily.ps1: a Scheduled Task calls this once a
    day after the NSE close, it runs the three publish steps in order, and it logs
    everything to logs\scan-YYYY-MM-DD.log.

    WHY THIS EXISTS
    The scan already runs on GitHub Actions. That works, but the alert then comes
    from GitHub, and the Supabase publish is the only thing that ever touches this
    PC. Running it here as well means Telegram alerts originate from this machine
    using the SAME XM_TG_TOKEN / XM_TG_CHAT the gold and BTC bots already use - no
    GitHub secrets required.

    CREDENTIALS
    Supabase keys are read out of apps\web\.env.local, which already holds them, so
    nothing new is stored and no secret is passed on the command line (a command
    line is visible to every other process on the machine).
    Telegram creds are inherited from the user environment, exactly like the bots.

    Usage:
        .\run_scan.ps1              full run: scan -> evaluate -> paper book
        .\run_scan.ps1 -DryRun      run the scan, publish nothing, alert nothing
#>

param(
    [switch]$DryRun
)

$ErrorActionPreference = "Continue"
$Root    = $PSScriptRoot
$LogDir  = Join-Path $Root "logs"
$LogFile = Join-Path $LogDir ("scan-" + (Get-Date -Format "yyyy-MM-dd") + ".log")

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

function Write-Log($msg) {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Write-Output $line
    Add-Content -Path $LogFile -Value $line -Encoding utf8
}

Write-Log "=== run_scan starting (DryRun=$DryRun) ==="
Set-Location $Root

# --- Supabase creds from .env.local -----------------------------------------
# Parsed rather than hardcoded so rotating a key in one place is enough.
$envFile = Join-Path $Root "apps\web\.env.local"
if (-not (Test-Path $envFile)) {
    Write-Log "FATAL: $envFile not found - cannot publish without Supabase keys"
    exit 1
}
$wanted = @{
    "NEXT_PUBLIC_SUPABASE_URL"  = "SUPABASE_URL"
    "SUPABASE_SERVICE_ROLE_KEY" = "SUPABASE_SERVICE_ROLE_KEY"
}
foreach ($line in Get-Content $envFile) {
    $t = $line.Trim()
    if ($t -eq "" -or $t.StartsWith("#") -or -not $t.Contains("=")) { continue }
    $k = $t.Substring(0, $t.IndexOf("=")).Trim()
    $v = $t.Substring($t.IndexOf("=") + 1).Trim().Trim('"')
    if ($wanted.ContainsKey($k) -and $v) { Set-Item -Path "Env:$($wanted[$k])" -Value $v }
}
if (-not $env:SUPABASE_URL -or -not $env:SUPABASE_SERVICE_ROLE_KEY) {
    Write-Log "FATAL: Supabase URL/key missing from .env.local"
    exit 1
}
Write-Log "supabase creds loaded"

# Telegram: inherited from the user environment, same as the MT5 bots.
if ($env:XM_TG_TOKEN -and $env:XM_TG_CHAT) {
    Write-Log "telegram creds present (chat $($env:XM_TG_CHAT)) - alerts WILL be sent"
} else {
    Write-Log "telegram creds NOT in environment - scan will publish but stay silent"
}

# Keep numeric libs single-threaded: this machine has hit OOM with default BLAS.
$env:PYTHONIOENCODING    = "utf-8"
$env:OPENBLAS_NUM_THREADS = "1"
$env:OMP_NUM_THREADS      = "1"

if ($DryRun) {
    Write-Log "dry run: scanning only, publishing nothing"
    & uv run swingscan scan 2>&1 | Tee-Object -FilePath $LogFile -Append -Encoding utf8
    Write-Log "=== run_scan finished (dry run) ==="
    exit 0
}

# --- the three steps, in dependency order -----------------------------------
# publish first (the paper book trades that day's signals), then evaluate, then
# the book. Each is independent: one failing must not skip the others, because a
# missed paper day repairs itself but a missed scan is lost history.
$steps = @(
    @{ Name = "scan + publish";    Module = "swingscan.publish" },
    @{ Name = "evaluate signals";  Module = "swingscan.evaluate" },
    @{ Name = "paper book";        Module = "swingscan.publish_paper" }
)

$failed = @()
foreach ($s in $steps) {
    Write-Log "--- $($s.Name) ---"
    & uv run python -m $($s.Module) 2>&1 | Tee-Object -FilePath $LogFile -Append -Encoding utf8
    if ($LASTEXITCODE -ne 0) {
        Write-Log "STEP FAILED: $($s.Name) exited $LASTEXITCODE"
        $failed += $s.Name
    } else {
        Write-Log "ok: $($s.Name)"
    }
}

if ($failed.Count -gt 0) {
    Write-Log "=== run_scan finished WITH FAILURES: $($failed -join ', ') ==="
    exit 1
}
Write-Log "=== run_scan finished clean ==="
exit 0
