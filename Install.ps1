#Requires -Version 5.1
<#
================================================================================
 Install.ps1
 목적: 피그마 연결 앱을 이 사용자 계정에 설치한다. 더블클릭(Setup.cmd / 설치.cmd)
       으로 실행한다. 관리자 권한은 필요 없다.
================================================================================
 [사용법]
   .\Install.ps1              → 설치 / 갱신 후 GUI 실행
   .\Install.ps1 -NoLaunch    → 설치만
   .\Install.ps1 -Status      → 지금 설치되어 있는지
   .\Install.ps1 -Uninstall   → 바로가기 · MCP 항목 · 중계 서버 · 설치 폴더
   .\Install.ps1 --help       → 이 사용법
================================================================================
#>

[CmdletBinding()]
param(
    [switch]$Uninstall,
    [switch]$Status,
    [switch]$NoLaunch,
    [Alias('h')]
    [switch]$Help,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$RemainingArgs
)

$ErrorActionPreference = 'Stop'
$lib = Join-Path $PSScriptRoot 'lib'
. (Join-Path $lib 'Common.ps1')
. (Join-Path $lib 'Engine.ps1')
. (Join-Path $lib 'Doctor.ps1')

function Test-FbHelpToken {
    param([string]$Token)
    if ([string]::IsNullOrWhiteSpace($Token)) { return $false }
    $t = $Token.Trim().ToLowerInvariant()
    return ($t -eq '-h' -or $t -eq '--help' -or $t -eq '/?' -or $t -eq 'help')
}

function Show-FbHelp {
    $raw = [IO.File]::ReadAllText($PSCommandPath)
    if ($raw -match '(?s)<#(.*?)#>') { Write-Host $Matches[1].Trim() }
}

if ($Help) { Show-FbHelp; return }
foreach ($a in @($RemainingArgs)) { if (Test-FbHelpToken $a) { Show-FbHelp; return } }

function Get-FbCopyNames {
    return @(
        'App.ps1', 'App.cmd', 'Install.ps1', 'Setup.cmd', 'Uninstall.cmd',
        'package.json'
    )
}

function Copy-FbTree {
    param([string]$From, [string]$To)
    if (-not (Test-Path -LiteralPath $To)) {
        New-Item -ItemType Directory -Path $To -Force | Out-Null
    }
    foreach ($name in @(Get-FbCopyNames)) {
        $src = Join-Path $From $name
        if (Test-Path -LiteralPath $src) {
            Copy-Item -LiteralPath $src -Destination (Join-Path $To $name) -Force
        }
    }
    $installCmd = Join-Path $From '설치.cmd'
    if (Test-Path -LiteralPath $installCmd) {
        Copy-Item -LiteralPath $installCmd -Destination (Join-Path $To '설치.cmd') -Force
    }
    foreach ($sub in @('lib', 'prompts')) {
        $src = Join-Path $From $sub
        $dst = Join-Path $To $sub
        if (Test-Path -LiteralPath $src) {
            if (Test-Path -LiteralPath $dst) {
                Remove-Item -LiteralPath $dst -Recurse -Force
            }
            Copy-Item -LiteralPath $src -Destination $dst -Recurse -Force
        }
    }
}

function Install-FbShortcut {
    param([string]$LinkPath, [string]$Target, [string]$WorkDir)
    $w = New-Object -ComObject WScript.Shell
    $s = $w.CreateShortcut($LinkPath)
    $s.TargetPath = $Target
    $s.WorkingDirectory = $WorkDir
    $s.WindowStyle = 1
    $s.Description = $script:FbProductName
    $figma = Get-FbFigmaPath
    if ($figma) { $s.IconLocation = "$figma,0" }
    $s.Save()
}

if ($Status) {
    $home = Get-FbHome
    $app = Join-Path $home 'App.cmd'
    if (Test-Path -LiteralPath $app) {
        Write-FbLine ok 'installed' $home
    } else {
        Write-FbLine warn 'installed' '없음'
    }
    foreach ($sc in @(Get-FbShortcutPaths)) {
        if (Test-Path -LiteralPath $sc.Path) {
            Write-FbLine ok $sc.Kind $sc.Path
        } else {
            Write-FbLine info $sc.Kind '바로가기 없음'
        }
    }
    return
}

if ($Uninstall) {
    Write-FbLine step 'uninstall' '연결 해제 후 설치 파일을 지웁니다.'
    try { [void](Invoke-FbDisconnect) } catch { }
    foreach ($sc in @(Get-FbShortcutPaths)) {
        if (Test-Path -LiteralPath $sc.Path) {
            Remove-Item -LiteralPath $sc.Path -Force
            Write-FbLine ok 'shortcut' ('지움: ' + $sc.Path)
        }
    }
    $home = Get-FbHome
    $here = [IO.Path]::GetFullPath($PSScriptRoot)
    $homeFull = [IO.Path]::GetFullPath($home)
    if ((Test-Path -LiteralPath $home) -and ($here -ne $homeFull) -and ($here -notlike "$homeFull*")) {
        Remove-Item -LiteralPath $home -Recurse -Force
        Write-FbLine ok 'home' "지움: $home"
    } else {
        Write-FbLine warn 'home' '실행 중인 폴더라서 파일은 남겼습니다. 바로가기와 연결만 해제했습니다.'
    }
    Write-FbLine ok 'done' '제거했습니다. 피그마 플러그인은 계정에 그대로 있습니다.'
    return
}

Write-FbLine step 'install' $script:FbProductName
Initialize-FbHome
$src = $PSScriptRoot
$dst = Get-FbHome
$srcFull = [IO.Path]::GetFullPath($src)
$dstFull = [IO.Path]::GetFullPath($dst)
if ($srcFull -ne $dstFull) {
    Copy-FbTree -From $src -To $dst
    Write-FbLine ok 'copy' $dst
} else {
    Write-FbLine info 'copy' '이미 설치 폴더에서 실행 중'
}

foreach ($sc in @(Get-FbShortcutPaths)) {
    $dir = Split-Path $sc.Path -Parent
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    Install-FbShortcut -LinkPath $sc.Path -Target (Join-Path $dst 'App.cmd') -WorkDir $dst
    Write-FbLine ok 'shortcut' $sc.Path
}

try {
    if (-not (Get-FbBunPath)) {
        Write-FbLine step 'bun' '설치 중…'
        $bun = Install-FbBun
        if ($bun) { Write-FbLine ok 'bun' $bun } else { Write-FbLine warn 'bun' '자동 설치 실패. 연결 버튼을 누르면 다시 시도합니다.' }
    } else {
        Write-FbLine ok 'bun' (Get-FbBunPath)
    }
    if (Get-FbBunPath) {
        Write-FbLine step 'packages' 'Talk to Figma 고정 버전을 받습니다…'
        [void](Install-FbPackages)
        Write-FbLine ok 'packages' '준비됨'
    }
} catch {
    Write-FbLine warn 'runtime' $_.Exception.Message
}

Write-FbLine ok 'done' '설치했습니다. 바탕화면의 "피그마 연결" 을 더블클릭하면 됩니다.'

if (-not $NoLaunch) {
    $appCmd = Join-Path $dst 'App.cmd'
    if (Test-Path -LiteralPath $appCmd) {
        Start-Process -FilePath $appCmd
    }
}
