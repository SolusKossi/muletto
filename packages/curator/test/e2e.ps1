# End-to-end test of the Muletto v0.1 pipeline: scan -> plan -> execute -> undo.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File test\e2e.ps1
# Requires node 18+ on PATH. Creates and removes its own temp folder. Exit 0 = pass.

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$t = Join-Path $env:TEMP ("mp-e2e-" + [guid]::NewGuid().ToString('N').Substring(0,8))
$root = Join-Path $t 'library'
$movedDest = Join-Path $t 'moved'
$nasDest = Join-Path $t 'nas'
New-Item -ItemType Directory -Force -Path $root, $movedDest, $nasDest | Out-Null
$fail = 0
function Assert([bool]$cond, [string]$msg) {
    if ($cond) { Write-Host "PASS  $msg" } else { Write-Host "FAIL  $msg"; $script:fail++ }
}

# --- fixture library ---
'photo-content-1'   | Out-File (Join-Path $root 'IMG_1001.HEIC') -Encoding ascii
'video-content-1'   | Out-File (Join-Path $root 'IMG_1001.MOV') -Encoding ascii
'old-screenshot'    | Out-File (Join-Path $root 'IMG_2000.PNG') -Encoding ascii
'new-screenshot'    | Out-File (Join-Path $root 'IMG_2001.PNG') -Encoding ascii
'dup-content-xyz'   | Out-File (Join-Path $root 'IMG_3000.JPG') -Encoding ascii
'dup-content-xyz'   | Out-File (Join-Path $root 'IMG_3001.JPG') -Encoding ascii
'chat-video'        | Out-File (Join-Path $root 'DEADBEEF-1234-5678-9ABC-DEF012345678.mp4') -Encoding ascii
New-Item (Join-Path $root 'empty.tmp') -ItemType File | Out-Null
(Get-Item (Join-Path $root 'IMG_2000.PNG')).LastWriteTime = (Get-Date).AddYears(-2)

# --- rules ---
$rules = @{
    version = 1
    rules = @(
        @{ id='r1'; text='never touch IMG_1001';                enabled=$true; match=@{ name_glob='IMG_1001.*' };                     action='keep' },
        @{ id='r2'; text='delete screenshots older than a year';enabled=$true; match=@{ categories=@('screenshot'); older_than_days=365 }; action='delete' },
        @{ id='r3'; text='delete duplicates';                   enabled=$true; match=@{ duplicates_only=$true };                      action='delete' },
        @{ id='r4'; text='move chat media';                     enabled=$true; match=@{ categories=@('chat_media') };                 action='move';     destination=$movedDest },
        @{ id='r5'; text='transfer junk';                       enabled=$true; match=@{ categories=@('junk') };                       action='transfer'; destination=$nasDest }
    )
}
$rulesPath = Join-Path $t 'rules.json'
$rules | ConvertTo-Json -Depth 6 | Out-File $rulesPath -Encoding ascii

# --- scan ---
$scanPath = Join-Path $t 'scan.json'
node (Join-Path $repo 'scanner\scan.js') $root --out $scanPath | Out-Null
Assert (Test-Path $scanPath) 'scan.json written'

# --- plan ---
$planPath = Join-Path $t 'plan.json'
node (Join-Path $repo 'src\plan.js') $scanPath $rulesPath --out $planPath | Out-Null
Assert (Test-Path $planPath) 'plan.json written'
$plan = Get-Content $planPath -Raw | ConvertFrom-Json
Assert (@($plan.keep_exceptions).Count -eq 2) "keep rule protects the live pair (got $(@($plan.keep_exceptions).Count))"
$acts = @{}; foreach ($i in $plan.items) { $acts[$i.path] = $i.action }
Assert ($acts['IMG_2000.PNG'] -eq 'delete') 'old screenshot -> delete'
Assert (-not $acts.ContainsKey('IMG_2001.PNG')) 'recent screenshot untouched'
$dupPlanned = @($plan.items | Where-Object { $_.path -like 'IMG_300*' })
Assert ($dupPlanned.Count -eq 1 -and $dupPlanned[0].action -eq 'delete') 'exactly one duplicate -> delete'
Assert ($acts['DEADBEEF-1234-5678-9ABC-DEF012345678.mp4'] -eq 'move') 'chat media -> move'
Assert ($acts['empty.tmp'] -eq 'transfer') 'junk -> transfer'

# --- execute dry run (no changes) ---
$before = (Get-ChildItem $root -File).Count
node (Join-Path $repo 'src\execute.js') $planPath | Out-Null
Assert ((Get-ChildItem $root -File).Count -eq $before) 'dry run changes nothing'

# --- execute commit ---
node (Join-Path $repo 'src\execute.js') $planPath --commit | Out-Null
$trash = Get-ChildItem (Join-Path $root '.muletto\trash') -Recurse -File -ErrorAction SilentlyContinue
Assert (@($trash | Where-Object Name -eq 'IMG_2000.PNG').Count -eq 1) 'screenshot staged to trash'
Assert (@($trash | Where-Object { $_.Name -like 'IMG_300*' }).Count -eq 1) 'one duplicate staged to trash'
Assert (Test-Path (Join-Path $movedDest 'DEADBEEF-1234-5678-9ABC-DEF012345678.mp4')) 'chat media moved'
Assert (Test-Path (Join-Path $nasDest 'empty.tmp')) 'junk transferred to destination'
Assert (-not (Test-Path (Join-Path $root 'empty.tmp'))) 'transferred original staged away'
Assert (Test-Path (Join-Path $root 'IMG_1001.HEIC')) 'kept file untouched'
Assert (Test-Path (Join-Path $root 'IMG_2001.PNG')) 'unmatched file untouched'
$manifest = Get-ChildItem (Join-Path $root '.muletto\runs') -Filter '*-manifest.json' | Sort-Object Name | Select-Object -Last 1
Assert ($null -ne $manifest) 'run manifest written'

# --- undo commit ---
node (Join-Path $repo 'src\undo.js') $manifest.FullName --commit | Out-Null
Assert (Test-Path (Join-Path $root 'IMG_2000.PNG')) 'undo restored screenshot'
Assert (Test-Path (Join-Path $root 'DEADBEEF-1234-5678-9ABC-DEF012345678.mp4')) 'undo restored moved file'
Assert (Test-Path (Join-Path $root 'empty.tmp')) 'undo restored transferred original'

Remove-Item $t -Recurse -Force
if ($fail -eq 0) { Write-Host 'E2E: ALL PASS'; exit 0 } else { Write-Host "E2E: $fail FAILURES"; exit 1 }
