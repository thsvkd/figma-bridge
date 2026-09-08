#Requires -Version 5.1
# 릴레이와 창 없는 실행기 회귀 검사.

$here = Split-Path $PSScriptRoot -Parent
. (Join-Path $here 'lib\Common.ps1')
. (Join-Path $here 'lib\Plugin.ps1')

# 1. 릴레이 파일이 제자리에 있어야 한다.
$relay = Get-FbRelayJs
if (Test-Path -LiteralPath $relay) {
    Add-WmResult 'Relay' 'file' 'PASS'
} else {
    Add-WmResult 'Relay' 'file' 'FAIL' "없음: $relay"
}

# 2. 중계 서버는 더 이상 소켓 npm 패키지를 요구하지 않는다.
$runtimeSrc = [IO.File]::ReadAllText((Join-Path $here 'lib\Runtime.ps1'))
if ($runtimeSrc -match 'Get-FbSocketJs') {
    Add-WmResult 'Relay' 'no-socket-pkg' 'FAIL' 'Test-FbPackagesPresent 가 아직 소켓 패키지를 봅니다'
} else {
    Add-WmResult 'Relay' 'no-socket-pkg' 'PASS'
}

# 3. 채널이 달라도 서로 통해야 한다. bun 이 없으면 건너뛴다.
$bun = Get-FbBunPath
if (-not $bun) {
    Add-WmResult 'Relay' 'bridge' 'PASS' 'bun 이 없어 건너뜀'
} else {
    $port = 3157
    $proc = $null
    try {
        $proc = Start-FbQuietProcess -FilePath $bun -ArgumentList @($relay) `
            -WorkingDirectory $here -Environment @{ FIGMA_BRIDGE_PORT = [string]$port }
        $deadline = (Get-Date).AddSeconds(10)
        $up = $false
        while ((Get-Date) -lt $deadline) {
            if (Test-FbPortOpen -Port $port) { $up = $true; break }
            Start-Sleep -Milliseconds 250
        }
        if (-not $up) {
            Add-WmResult 'Relay' 'bridge' 'FAIL' '릴레이가 뜨지 않았습니다'
        } else {
            $check = Join-Path $PSScriptRoot 'relay-check.js'
            $outPath = Join-Path $env:TEMP ('relay-check-{0}.out' -f (Get-FbTimestamp))
            $errPath = Join-Path $env:TEMP ('relay-check-{0}.err' -f (Get-FbTimestamp))
            [void](Start-FbQuietProcess -FilePath $bun -ArgumentList @($check, [string]$port) `
                    -WorkingDirectory $here -StdOutPath $outPath -StdErrPath $errPath -Wait)
            $out = ''
            if (Test-Path -LiteralPath $outPath) { $out = [IO.File]::ReadAllText($outPath) }
            if ($out -match 'RELAY-OK') {
                Add-WmResult 'Relay' 'bridge' 'PASS'
            } else {
                $detail = $out.Trim()
                if (-not $detail -and (Test-Path -LiteralPath $errPath)) { $detail = [IO.File]::ReadAllText($errPath).Trim() }
                Add-WmResult 'Relay' 'bridge' 'FAIL' $detail
            }
            foreach ($p in @($outPath, $errPath)) {
                if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue }
            }
        }
    } finally {
        if ($proc -and -not $proc.HasExited) {
            try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch { }
        }
    }
}

# 4. 실행기는 창 없이 떠야 한다.
$vbs = Join-Path $here 'App.vbs'
if (-not (Test-Path -LiteralPath $vbs)) {
    Add-WmResult 'Launcher' 'vbs' 'FAIL' 'App.vbs 없음'
} else {
    $vbsSrc = [IO.File]::ReadAllText($vbs)
    if ($vbsSrc -match 'sh\.Run cmd, 0, False') {
        Add-WmResult 'Launcher' 'vbs' 'PASS'
    } else {
        Add-WmResult 'Launcher' 'vbs' 'FAIL' '창 숨김(0) 으로 실행하지 않습니다'
    }
}

$installSrc = [IO.File]::ReadAllText((Join-Path $here 'Install.ps1'))
if ($installSrc -match 'wscript\.exe' -and $installSrc -match 'App\.vbs') {
    Add-WmResult 'Launcher' 'shortcut' 'PASS'
} else {
    Add-WmResult 'Launcher' 'shortcut' 'FAIL' '바로가기가 아직 콘솔 실행기를 가리킵니다'
}

# 5. SendKeys 로 보낼 문자열은 특수문자를 감싸야 한다.
$escaped = ConvertTo-FbSendKeysText -Text 'Talk (To) +Figma'
if ($escaped -eq 'Talk {(}To{)} {+}Figma') {
    Add-WmResult 'Plugin' 'sendkeys-escape' 'PASS'
} else {
    Add-WmResult 'Plugin' 'sendkeys-escape' 'FAIL' $escaped
}
