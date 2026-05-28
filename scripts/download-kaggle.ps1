Param(
    [string]$OutputDirectory = "kaggle-datasets"
)

$ErrorActionPreference = "Stop"

$kaggle = Get-Command kaggle -ErrorAction SilentlyContinue
if (-not $kaggle) {
    Write-Host "Kaggle CLI chua duoc cai."
    Write-Host "Cai bang: python -m pip install kaggle"
    Write-Host "Sau do dat kaggle.json tai: $env:USERPROFILE\.kaggle\kaggle.json"
    exit 1
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$datasets = @(
    "exercisedb/fitness-exercises-dataset",
    "omarxadel/fitness-exercises-dataset"
)

foreach ($dataset in $datasets) {
    $name = ($dataset -replace "/", "__")
    $target = Join-Path $OutputDirectory $name
    New-Item -ItemType Directory -Force -Path $target | Out-Null

    Write-Host "Downloading Kaggle dataset: $dataset"
    kaggle datasets download -d $dataset -p $target --unzip
}

Write-Host "Done. Files saved under: $OutputDirectory"
