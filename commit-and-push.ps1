# PowerShell script to commit and push changes to GitHub

# Change to project directory
Set-Location "C:\Users\aabloch\claude\vibe-coding\Recipe Genie"

# Stage all changes (modified and new files)
Write-Host "Staging all changes..." -ForegroundColor Cyan
git add .

# Check if there are any changes to commit
$status = git status --porcelain
if ($status) {
    # Create commit message based on changes
    $commitMessage = "Update: Add custom categories feature and UI improvements
    
- Add custom shopping categories migration (007_custom_categories.sql)
- Add first-run onboarding component
- Add recipe-to-plan modal component
- Add shopping settings modal
- Add empty state and undo toast UI components
- Update shopping list with custom categories support
- Update meal planner and related components
- Update various UI components and hooks"

    Write-Host "Committing changes..." -ForegroundColor Cyan
    git commit -m $commitMessage

    Write-Host "Pushing to GitHub..." -ForegroundColor Cyan
    git push origin main

    Write-Host "Successfully committed and pushed changes to GitHub!" -ForegroundColor Green
} else {
    Write-Host "No changes to commit." -ForegroundColor Yellow
}
