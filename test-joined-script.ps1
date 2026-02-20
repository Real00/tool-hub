$paths = @("C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Google Chrome.lnk")
$payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($paths | ConvertTo-Json)))

$command = @(
    "`$json=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$payload'))",
    "`$items=`$json|ConvertFrom-Json",
    "if(`$items -isnot [System.Array]){`$items=@(`$items)}",
    "`$shell=New-Object -ComObject WScript.Shell",
    "`$rows=@()",
    "foreach(`$item in `$items){",
    "  try{",
    "    `$shortcut=`$shell.CreateShortcut([string]`$item)",
    "    `$rows+=[pscustomobject]@{",
    "      shortcutPath=[string]`$item",
    "      targetPath=[string]`$shortcut.TargetPath",
    "      iconLocation=[string]`$shortcut.IconLocation",
    "    }",
    "  }catch{}",
    "}",
    "`$rows|ConvertTo-Json -Compress"
) -join ";"

Write-Host "Command length: $($command.Length)"
Write-Host "Executing..."
Write-Host ""

$result = powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $command
Write-Host "Result: $result"
