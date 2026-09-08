#Requires -Version 5.1
<#
================================================================================
 App.ps1
 목적: Talk to Figma MCP 로 Claude Code / Codex 와 피그마 앱을 연결한다.
       인자 없이 실행하면 디자이너용 GUI. -Action 이면 CLI.
================================================================================
 [사용법]
   .\App.ps1                         → GUI
   .\App.ps1 -Action status          → 지금 상태 (읽기 전용)
   .\App.ps1 -Action connect         → 중계 서버 + 하네스 연결
   .\App.ps1 -Action disconnect      → 연결 해제
   .\App.ps1 -Action doctor [-Fix]   → 결정론 점검 (기본은 고침)
   .\App.ps1 -Action socket-start
   .\App.ps1 -Action socket-stop
   .\App.ps1 -Action ai-doctor       → 결정론이 막힌 뒤 로컬 하네스에 맡김
   .\App.ps1 --help                  → 이 사용법
================================================================================
#>

[CmdletBinding()]
param(
    [string]$Action,
    [switch]$Fix,
    [switch]$Json,
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
    if ($raw -match '(?s)<#(.*?)#>') {
        Write-Host $Matches[1].Trim()
    }
}

if ($Help -or (Test-FbHelpToken $Action)) {
    Show-FbHelp
    return
}
foreach ($a in @($RemainingArgs)) {
    if (Test-FbHelpToken $a) { Show-FbHelp; return }
}

function Write-FbStatusCli {
    param($Status)
    if ($Json) {
        $Status | ConvertTo-Json -Depth 8
        return
    }
    Write-FbLine info 'product' $script:FbProductName
    Write-FbLine info 'home' (Get-FbHome)
    if ($Status.Bun) { Write-FbLine ok 'bun' $Status.Bun } else { Write-FbLine err 'bun' '없음' }
    if ($Status.Packages) { Write-FbLine ok 'packages' '준비됨' } else { Write-FbLine warn 'packages' '없음' }
    if ($Status.Socket.HttpOk -and $Status.RelayOk) { Write-FbLine ok 'socket' '3055 응답' }
    elseif ($Status.Socket.HttpOk) { Write-FbLine warn 'socket' '3055 를 다른 서버가 쓰는 중' }
    else { Write-FbLine err 'socket' '꺼짐' }
    if ($Status.PluginOn) { Write-FbLine ok 'plugin' '피그마 플러그인 연결됨' } else { Write-FbLine warn 'plugin' '피그마 플러그인 미연결' }
    if ($Status.FigmaRunning) { Write-FbLine ok 'figma' '실행 중' } elseif ($Status.FigmaPath) { Write-FbLine warn 'figma' '꺼짐' } else { Write-FbLine err 'figma' '미설치' }
    if ($Status.ClaudeMcp) { Write-FbLine ok 'claude' 'TalkToFigma' } elseif ($Status.ClaudePath) { Write-FbLine warn 'claude' '미연결' } else { Write-FbLine info 'claude' '미설치' }
    if ($Status.DesktopMcp) { Write-FbLine ok 'claude-desktop' 'TalkToFigma' } else { Write-FbLine info 'claude-desktop' '미연결' }
    if ($Status.CodexMcp) { Write-FbLine ok 'codex' 'TalkToFigma' } elseif ($Status.CodexPath) { Write-FbLine warn 'codex' '미연결' } else { Write-FbLine info 'codex' '미설치' }
}

function Write-FbDoctorCli {
    param($Doc)
    if ($Json) { $Doc | ConvertTo-Json -Depth 8; return }
    foreach ($a in @($Doc.Applied)) { Write-FbLine info 'fix' $a }
    foreach ($c in @($Doc.After)) {
        $kind = switch ($c.Status) { 'ok' { 'ok' } 'fail' { 'err' } default { 'warn' } }
        $text = $c.Text
        if ($c.Hint) { $text = "$text  |  $($c.Hint)" }
        Write-FbLine $kind $c.Label $text
    }
    if ($Doc.AiEligible) {
        Write-FbLine warn 'ai' '결정론으로 안 끝나면 -Action ai-doctor 로 로컬 하네스에 맡기세요.'
    }
}

if ([string]::IsNullOrWhiteSpace($Action)) {
    $sta = [System.Threading.Thread]::CurrentThread.GetApartmentState()
    if ($sta -ne 'STA') {
        $ps = (Get-Command powershell.exe).Source
        $p = Start-FbQuietProcess -FilePath $ps `
            -ArgumentList @('-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath) -Wait
        exit $p.ExitCode
    }
    . (Join-Path $lib 'Gui.ps1')
    Show-FbGui
    return
}

$act = $Action.Trim().ToLowerInvariant()
switch ($act) {
    'status' {
        Write-FbStatusCli (Get-FbOverallStatus)
    }
    'connect' {
        $r = Invoke-FbConnect
        foreach ($n in @($r.Notes)) { Write-FbLine ok 'connect' $n }
        foreach ($h in @($r.Harness)) {
            if ($h.Ok) { Write-FbLine ok $h.Target $h.Detail } else { Write-FbLine warn $h.Target $h.Detail }
        }
        if ($r.Plugin) {
            if ($r.Plugin.Ok) {
                Write-FbLine ok 'plugin' $r.Plugin.Detail
            } else {
                Write-FbLine warn 'plugin' $r.Plugin.Detail
                Write-FbLine info 'plugin-url' $script:FbPluginUrl
            }
        }
    }
    'disconnect' {
        [void](Invoke-FbDisconnect)
        Write-FbLine ok 'disconnect' 'TalkToFigma 항목을 빼고 중계 서버를 멈췄습니다.'
    }
    'doctor' {
        $doFix = $true
        if ($PSBoundParameters.ContainsKey('Fix') -and -not $Fix) { $doFix = $false }
        # CLI default: fix. Pass -Fix:$false to view only. Bare -Action doctor still fixes.
        if ($RemainingArgs -contains '-DryRun' -or $RemainingArgs -contains '--dry-run') { $doFix = $false }
        $doc = Invoke-FbDoctor -Fix:$doFix
        Write-FbDoctorCli $doc
        if (-not $doc.Ok) { exit 2 }
    }
    'socket-start' {
        $s = Start-FbSocket
        if ($s.HttpOk) { Write-FbLine ok 'socket' '3055 응답' } else { Write-FbLine err 'socket' '시작 실패'; exit 1 }
    }
    'socket-stop' {
        [void](Stop-FbSocket)
        Write-FbLine ok 'socket' '중지'
    }
    'ai-doctor' {
        $doc = Invoke-FbDoctor -Fix
        Write-FbDoctorCli $doc
        if (-not $doc.AiEligible -and $doc.Ok) {
            Write-FbLine ok 'ai' '결정론 점검으로 충분합니다. 하네스에 맡기지 않습니다.'
            return
        }
        $ai = Invoke-FbAiDoctor -Doctor $doc
        Write-FbLine info 'harness' $ai.Harness
        Write-Host (Protect-FbSecretText -Text $ai.Output)
        Write-FbLine info 'log' $ai.LogPath
        if ($ai.ExitCode -ne 0) { exit $ai.ExitCode }
    }
    default {
        Write-FbLine err 'action' "모르는 동작: $Action"
        Write-FbLine info 'hint' 'status / connect / disconnect / doctor / socket-start / socket-stop / ai-doctor'
        exit 1
    }
}
