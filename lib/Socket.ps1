#Requires -Version 5.1
# Talk to Figma WebSocket relay on 127.0.0.1:3055.

. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot 'Runtime.ps1')

function Get-FbSocketProcess {
    $pidPath = Get-FbPidPath
    if (Test-Path -LiteralPath $pidPath) {
        $raw = [IO.File]::ReadAllText($pidPath).Trim()
        [int]$savedPid = 0
        if ([int]::TryParse($raw, [ref]$savedPid)) {
            $proc = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
            if ($proc) { return $proc }
        }
    }

    $hits = @()
    try {
        $hits = @(Get-CimInstance Win32_Process -Filter "Name = 'bun.exe' OR Name = 'node.exe'" -ErrorAction SilentlyContinue |
                Where-Object {
                    $_.CommandLine -and
                    ($_.CommandLine -match 'cursor-talk-to-figma-socket' -or
                     $_.CommandLine -match 'dist\\socket\.js' -or
                     $_.CommandLine -match 'dist/socket\.js' -or
                     $_.CommandLine -match 'relay\.js')
                })
    } catch { }
    if ($hits.Count -gt 0) {
        return (Get-Process -Id $hits[0].ProcessId -ErrorAction SilentlyContinue)
    }
    return $null
}

function Get-FbSocketStatus {
    $proc = Get-FbSocketProcess
    $port = Test-FbPortOpen -Port $script:FbPort
    $body = $null
    if ($port) { $body = Get-FbHttpText -Url ("http://127.0.0.1:{0}/" -f $script:FbPort) }
    $httpOk = $false
    if ($body -and $body -match 'WebSocket') { $httpOk = $true }

    # 플러그인이 실제로 붙었는지는 우리 릴레이의 /status 가 알려준다.
    $relay = $null
    if ($httpOk) { $relay = Get-FbRelayStatus }
    $channels = @()
    if ($relay -and $relay.channels) { $channels = @($relay.channels) }

    return [pscustomobject]@{
        Process          = $proc
        Pid              = $(if ($proc) { $proc.Id } else { $null })
        PortOpen         = $port
        HttpOk           = $httpOk
        HttpBody         = $body
        Relay            = $relay
        IsOurs           = [bool]$relay
        PluginConnected  = [bool]($relay -and $relay.figmaJoined -gt 0)
        HarnessConnected = [bool]($relay -and $relay.harnessJoined -gt 0)
        Channels         = $channels
        PluginSeen       = [bool]($relay -and $relay.figmaJoined -gt 0)
        Running          = [bool]($proc -or $port)
    }
}

# 3055 를 쥐고 있는 프로세스. 우리 것이 아닐 수도 있다.
function Get-FbPortOwnerProcess {
    param([int]$Port = 3055)
    try {
        $conns = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
        foreach ($c in $conns) {
            $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
            if ($p) { return $p }
        }
    } catch { }
    return $null
}

function Start-FbSocket {
    param([switch]$DryRun)
    $st = Get-FbSocketStatus
    if ($st.HttpOk -and $st.IsOurs) { return $st }

    if ($DryRun) { return $st }

    Initialize-FbHome
    $bun = Get-FbBunPath
    if (-not $bun) { $bun = Install-FbBun }
    if (-not $bun) { throw 'Bun 이 없어 중계 서버를 시작할 수 없습니다.' }
    $relayJs = Get-FbRelayJs
    if (-not (Test-Path -LiteralPath $relayJs)) { throw "릴레이 파일이 없습니다: $relayJs" }

    # 예전 소켓 서버든 우리 릴레이의 잔여 프로세스든 먼저 치운다.
    $stale = $st.Process
    if (-not $stale -and $st.PortOpen) {
        $owner = Get-FbPortOwnerProcess -Port $script:FbPort
        if ($owner -and @('bun', 'node') -contains $owner.ProcessName) { $stale = $owner }
    }
    if ($stale) {
        try { Stop-Process -Id $stale.Id -Force -ErrorAction SilentlyContinue } catch { }
        Start-Sleep -Milliseconds 300
    } elseif ($st.PortOpen) {
        throw "$($script:FbPort) 포트를 다른 프로그램이 쓰고 있습니다. 그 프로그램을 끄고 다시 시도하세요."
    }

    $logPath = Join-Path (Get-FbLogDir) ('relay-{0}.log' -f (Get-FbTimestamp))
    $proc = Start-FbQuietProcess -FilePath $bun -ArgumentList @($relayJs) -WorkingDirectory (Get-FbHome) `
        -Environment @{ FIGMA_BRIDGE_PORT = [string]$script:FbPort; FIGMA_BRIDGE_LOG = $logPath }
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [IO.File]::WriteAllText((Get-FbPidPath), [string]$proc.Id, $utf8)

    $state = Get-FbState
    $state.socketPid = $proc.Id
    Save-FbState -State $state

    $deadline = (Get-Date).AddSeconds(10)
    do {
        Start-Sleep -Milliseconds 250
        $st = Get-FbSocketStatus
        if ($st.HttpOk -and $st.IsOurs) { return $st }
    } while ((Get-Date) -lt $deadline)

    throw "중계 서버가 뜨지 않았습니다. 로그: $logPath"
}

function Stop-FbSocket {
    param([switch]$DryRun)
    $st = Get-FbSocketStatus
    if ($DryRun) { return $st }
    if ($st.Process) {
        try { Stop-Process -Id $st.Process.Id -Force -ErrorAction SilentlyContinue } catch { }
    }
    $pidPath = Get-FbPidPath
    if (Test-Path -LiteralPath $pidPath) { Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue }
    $state = Get-FbState
    $state.socketPid = $null
    Save-FbState -State $state
    Start-Sleep -Milliseconds 200
    return (Get-FbSocketStatus)
}
