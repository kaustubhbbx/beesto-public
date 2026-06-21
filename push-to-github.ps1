Write-Host "=============================================" -ForegroundColor Green
Write-Host "   Beesto AI Public Repository Push Helper   " -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""
Write-Host "This script will initialize a local git repository in this folder"
Write-Host "and guide you in pushing the core logic files to GitHub."
Write-Host ""
Write-Host "Step 1: Create a NEW PUBLIC repository on GitHub."
Write-Host "        - Go to https://github.com/new"
Write-Host "        - Set the name (e.g. 'beesto-ai-core')"
Write-Host "        - Set it to PUBLIC"
Write-Host "        - Do NOT add a README, .gitignore, or license."
Write-Host "        - Click 'Create repository'"
Write-Host ""

$repoUrl = Read-Host "Step 2: Enter your GitHub Repository URL (e.g., https://github.com/your-username/beesto-ai-core.git)"

if (-not $repoUrl) {
    Write-Host "Error: No repository URL entered. Exiting." -ForegroundColor Red
    Exit
}

# Run git operations
Write-Host "`nInitializing git..." -ForegroundColor Cyan
git init

Write-Host "`nAdding core files..." -ForegroundColor Cyan
git add .

Write-Host "`nCreating initial commit..." -ForegroundColor Cyan
git commit -m "Initial commit of Beesto AI core logic & auth middleware"

Write-Host "`nSetting main branch..." -ForegroundColor Cyan
git branch -M main

# Check if origin already exists
$remoteExists = git remote | Select-String "origin"
if ($remoteExists) {
    git remote remove origin
}

Write-Host "`nAdding remote origin..." -ForegroundColor Cyan
git remote add origin $repoUrl

Write-Host "`nPushing to GitHub..." -ForegroundColor Cyan
git push -u origin main

Write-Host "`nDone! Your public core logic files are now uploaded to GitHub." -ForegroundColor Green
Write-Host "Verify your repository URL: $repoUrl" -ForegroundColor Green
