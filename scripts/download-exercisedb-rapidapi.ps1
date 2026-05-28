Param(
    [Parameter(Mandatory = $true)]
    [string]$ApiKey
)

$ErrorActionPreference = "Stop"

$repo = Join-Path (Get-Location) "ExerciseGifDownloader"
if (-not (Test-Path $repo)) {
    throw "Missing ExerciseGifDownloader directory. Clone https://github.com/XZE3N/ExerciseGifDownloader first."
}

Push-Location $repo
try {
    .\Request-Exercises.ps1 -ApiKey $ApiKey
    .\Get-Exercises.ps1
}
finally {
    Pop-Location
}
