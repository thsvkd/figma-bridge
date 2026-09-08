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
                    ($_.CommandLine -match 'cursor-talk-to-figma-socket' -or $_.CommandLine -match 'dist\\socket\.js' -or $_.CommandLine -match 'dist/socket\.js')
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

    $logText = ''
    $logDir = Get-FbLogDir
    if (Test-Path -LiteralPath $logDir) {
        $latest = Get-ChildItem -LiteralPath $logDir -Filter 'socket-*.out.log' -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
        if ($latest) {
            try { $logText = [IO.File]::ReadAllText($latest.FullName) } catch { }
        }
    }
    $pluginSeen = $false
    if ($logText -match 'joined channel') { $pluginSeen = $true }

    return [pscustomobject]@{
        Process     = $proc
        Pid         = $(if ($proc) { $proc.Id } else { $null })
        PortOpen    = $port
        HttpOk      = $httpOk
        HttpBody    = $body
        PluginSeen  = $pluginSeen
        Running     = [bool]($proc -or $port)
    }
}

function Start-FbSocket {
    param([switch]$DryRun)
    $st = Get-FbSocketStatus
    if ($st.HttpOk) { return $st }

    if ($DryRun) { return $st }

    Initialize-FbHome
    if (-not (Test-FbPackagesPresent)) { [void](Install-FbPackages) }
    $bun = Get-FbBunPath
    if (-not $bun) { $bun = Install-FbBun }
    if (-not $bun) { throw 'Bun 이 없어 중계 서버를 시작할 수 없습니다.' }
    $socketJs = Get-FbSocketJs
    if (-not (Test-Path -LiteralPath $socketJs)) { throw "소켓 파일이 없습니다: $socketJs" }

    if ($st.Process) {
        try { Stop-Process -Id $st.Process.Id -Force -ErrorAction SilentlyContinue } catch { }
        Start-Sleep -Milliseconds 300
    }

    $stamp = Get-FbTimestamp
    $outLog = Join-Path (Get-FbLogDir) ('socket-{0}.out.log' -f $stamp)
    $errLog = Join-Path (Get-FbLogDir) ('socket-{0}.err.log' -f $stamp)
    $proc = Start-Process -FilePath $bun -ArgumentList @($socketJs) -WorkingDirectory (Get-FbHome) `
        -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [IO.File]::WriteAllText((Get-FbPidPath), [string]$proc.Id, $utf8)

    $state = Get-FbState
    $state.socketPid = $proc.Id
    Save-FbState -State $state

    $deadline = (Get-Date).AddSeconds(8)
    do {
        Start-Sleep -Milliseconds 250
        $st = Get-FbSocketStatus
        if ($st.HttpOk) { return $st }
    } while ((Get-Date) -lt $deadline)

    if (-not $st.Running) {
        throw "중계 서버가 뜨지 않았습니다. 로그: $log"
    }
    return $st
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
