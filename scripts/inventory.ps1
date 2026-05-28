$ErrorActionPreference = "Stop"

Write-Host "Workspace inventory"
Write-Host "==================="

if (Test-Path "hasaneyldrm-exercises-dataset\data\exercises.json") {
    $items = Get-Content "hasaneyldrm-exercises-dataset\data\exercises.json" -Raw | ConvertFrom-Json
    $images = @(Get-ChildItem "hasaneyldrm-exercises-dataset\images" -File -ErrorAction SilentlyContinue)
    $gifs = @(Get-ChildItem "hasaneyldrm-exercises-dataset\videos" -File -ErrorAction SilentlyContinue)

    Write-Host "hasaneyldrm exercises: $($items.Count)"
    Write-Host "hasaneyldrm images:    $($images.Count)"
    Write-Host "hasaneyldrm gifs:      $($gifs.Count)"
}
else {
    Write-Host "hasaneyldrm dataset not found"
}

if (Test-Path "kaggle-datasets") {
    Get-ChildItem "kaggle-datasets" -Recurse -File |
        Group-Object Extension |
        Sort-Object Name |
        Select-Object Name, Count
}
