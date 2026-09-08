#Requires -Version 5.1
# Connect / disconnect pipeline used by GUI and CLI.

. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot 'Runtime.ps1')
. (Join-Path $PSScriptRoot 'Socket.ps1')
. (Join-Path $PSScriptRoot 'Harness.ps1')
. (Join-Path $PSScriptRoot 'Plugin.ps1')

function Invoke-FbConnect {
    param([switch]$DryRun)
    $notes = New-Object System.Collections.Generic.List[string]
    if ($DryRun) {
        $notes.Add('Bun · 패키지 · 중계 서버 · 하네스 설정을 손볼 수 있습니다.')
        return [pscustomobject]@{ Ok = $true; Notes = $notes; Harness = @(); Plugin = $null }
    }

    if (-not (Get-FbBunPath)) {
        $bun = Install-FbBun
        if (-not $bun) { throw 'Bun 설치에 실패했습니다.' }
        $notes.Add("Bun: $bun")
    } else {
        $notes.Add('Bun 준비됨')
    }

    [void](Install-FbPackages)
    $notes.Add('Talk to Figma 패키지 준비됨')

    $sock = Start-FbSocket
    if (-not $sock.HttpOk -and -not $sock.Running) {
        throw '중계 서버가 응답하지 않습니다.'
    }
    $notes.Add('중계 서버(3055) 실행 중')

    $harness = @(Connect-FbHarnesses)
    $okAny = @($harness | Where-Object { $_.Ok }).Count -gt 0
    if (-not $okAny) {
        throw '연결할 하네스(Claude Code / Codex)가 없습니다. 먼저 설치하세요.'
    }

    # 피그마 앱 실행과 플러그인 실행까지 연결 버튼이 책임진다.
    $plugin = Start-FbPlugin
    if ($plugin.Ok) { $notes.Add($plugin.Detail) }

    return [pscustomobject]@{ Ok = $true; Notes = $notes; Harness = $harness; Plugin = $plugin }
}

function Invoke-FbDisconnect {
    param([switch]$DryRun)
    $harness = @(Disconnect-FbHarnesses -DryRun:$DryRun)
    $sock = Stop-FbSocket -DryRun:$DryRun
    return [pscustomobject]@{
        Ok      = $true
        Harness = $harness
        Socket  = $sock
    }
}

function Get-FbOverallStatus {
    $bun = Get-FbBunPath
    $node = Get-FbNodePath
    $claude = Get-FbClaudePath
    $codex = Get-FbCodexPath
    $figma = Get-FbFigmaPath
    $sock = Get-FbSocketStatus
    $launch = $null
    if (Test-FbPackagesPresent) { $launch = Get-FbMcpLaunch }

    $claudeMcp = $false
    if ($claude) { $claudeMcp = Test-FbClaudeUserMcp }
    $desktopPath = Get-FbClaudeDesktopConfigPath
    $desktopMcp = Test-FbJsonMcpEntry -Path $desktopPath -Name $script:FbMcpName
    $codexMcp = $false
    if ($codex) { $codexMcp = Test-FbCodexMcp }

    $connected = $sock.HttpOk -and ($claudeMcp -or $desktopMcp -or $codexMcp)

    return [pscustomobject]@{
        Bun          = $bun
        Node         = $node
        Packages     = [bool](Test-FbPackagesPresent)
        Launch       = $launch
        Socket       = $sock
        FigmaPath    = $figma
        FigmaRunning = [bool](Test-FbFigmaRunning)
        ClaudePath   = $claude
        ClaudeMcp    = $claudeMcp
        DesktopMcp   = $desktopMcp
        CodexPath    = $codex
        CodexMcp     = $codexMcp
        Connected    = $connected
        RelayOk      = [bool]$sock.IsOurs
        PluginOn     = [bool]$sock.PluginConnected
        Channels     = @($sock.Channels)
        PluginUrl    = $script:FbPluginUrl
        PluginName   = $script:FbPluginName
        ChannelHint  = $script:FbChannelHint
    }
}
