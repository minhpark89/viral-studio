param([string]$AppPath, [string]$OutputDirectory)
$ErrorActionPreference = 'Stop'

if (-not $AppPath) {
    $candidates = @(
        (Join-Path $PSScriptRoot 'Viral.Studio.0.7.8.exe'),
        (Join-Path $PSScriptRoot 'Viral Studio.exe'),
        (Join-Path $PSScriptRoot '..\release\Viral.Studio.0.7.8.exe')
    )
    $AppPath = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
if (-not $AppPath) { throw 'Pass -AppPath with the path to Viral Studio 0.7.8 Portable or the installed EXE.' }
$AppPath = (Resolve-Path -LiteralPath $AppPath).Path
if (-not $OutputDirectory) { $OutputDirectory = Join-Path (Split-Path $AppPath -Parent) 'Render Test Results' }
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
$runDirectory = Join-Path $OutputDirectory ('run-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
Write-Host 'Running offline render checks (no accounts or API credits required)...'
Write-Host ('App SHA256: ' + (Get-FileHash -LiteralPath $AppPath -Algorithm SHA256).Hash)
Write-Host ('Results: ' + $runDirectory)
$arguments = '"--render-self-test={0}"' -f $runDirectory
$process = Start-Process -FilePath $AppPath -ArgumentList $arguments -PassThru -WindowStyle Hidden
$reportFile = Join-Path $runDirectory 'report.json'
$deadline = (Get-Date).AddMinutes(32)
$lastStage = ''
$report = $null
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    if (Test-Path -LiteralPath $reportFile) {
        try { $report = Get-Content -LiteralPath $reportFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch { continue }
        if ($report.stage -ne $lastStage) { Write-Host $report.stage; $lastStage = $report.stage }
        if ($report.finished) { break }
    }
    $process.Refresh()
    if ($process.HasExited) {
        if (-not $report -or -not $report.finished) { throw "The app exited before completing its test. Check $runDirectory" }
        break
    }
}
if (-not $report -or -not $report.finished) { throw "Test did not finish within 32 minutes. Check $runDirectory" }
if ($report.version -ne '0.7.8') { throw "Wrong app version tested: $($report.version). Use 0.7.8." }
Get-Content -LiteralPath (Join-Path $runDirectory 'RESULT.txt') -Encoding UTF8
if (-not $report.passed) { exit 1 }
exit 0
