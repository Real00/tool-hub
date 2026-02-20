$testPath = "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Google Chrome.lnk"

Write-Host "Testing shortcut: $testPath"
Write-Host "File exists: $(Test-Path $testPath)"

try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($testPath)

    Write-Host "Target: $($shortcut.TargetPath)"
    Write-Host "Icon: $($shortcut.IconLocation)"

    $result = [pscustomobject]@{
        shortcutPath = $testPath
        targetPath = [string]$shortcut.TargetPath
        iconLocation = [string]$shortcut.IconLocation
    }

    $result | ConvertTo-Json
} catch {
    Write-Host "Error: $_"
}
