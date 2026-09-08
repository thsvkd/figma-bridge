#Requires -Version 5.1
# 하네스(Claude Code / Codex / Claude Desktop) 설치.
# 개발자 세팅이 전혀 없는 윈도우에서도 되게 하는 것이 목표다.
# 1순위 winget(관리자 권한 불필요), 2순위 공식 설치 스크립트.
# 스크립트는 파일로 받아서 -NoProfile -ExecutionPolicy Bypass 로 돈다.
# 내려받은 스크립트를 셸에 바로 흘려 넣으면 프로필과 실행정책에 걸리고,
# 실패해도 오류 위치가 첫 줄로 뭉개져 원인을 못 찾는다.

. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot 'Harness.ps1')

function Get-FbHarnessCatalog {
    return @(
        [pscustomobject]@{
            Id          = 'claude'
            Name        = 'Claude Code'
            Recommended = $true
            WingetId    = 'Anthropic.ClaudeCode'
            ScriptUrl   = 'https://claude.ai/install.ps1'
            ManualUrl   = 'https://docs.claude.com/en/docs/claude-code/setup'
            LoginArgs   = @()
            LoginNote   = '터미널에서 claude 를 실행하면 브라우저로 로그인합니다.'
            Path        = (Get-FbClaudePath)
        },
        [pscustomobject]@{
            Id          = 'codex'
            Name        = 'Codex CLI'
            Recommended = $false
            WingetId    = 'OpenAI.Codex'
            ScriptUrl   = 'https://chatgpt.com/codex/install.ps1'
            ManualUrl   = 'https://developers.openai.com/codex/cli'
            LoginArgs   = @('login')
            LoginNote   = '터미널에서 codex login 을 실행하면 브라우저로 로그인합니다.'
            Path        = (Get-FbCodexPath)
        },
        [pscustomobject]@{
            Id          = 'claude-desktop'
            Name        = 'Claude Desktop'
            Recommended = $false
            WingetId    = 'Anthropic.Claude'
            ScriptUrl   = ''
            ManualUrl   = 'https://claude.ai/download'
            LoginArgs   = @()
            LoginNote   = '앱을 열고 로그인하면 됩니다.'
            Path        = (Get-FbClaudeDesktopDir)
        }
    )
}

function Get-FbHarnessEntry {
    param([Parameter(Mandatory = $true)][string]$Id)
    $hit = @(Get-FbHarnessCatalog | Where-Object { $_.Id -eq $Id })
    if ($hit.Count -eq 0) { throw "모르는 하네스: $Id" }
    return $hit[0]
}

function Test-FbAnyHarness {
    return (@(Get-FbHarnessCatalog | Where-Object { $_.Path }).Count -gt 0)
}

function Get-FbHarnessPath {
    param([Parameter(Mandatory = $true)][string]$Id)
    switch ($Id) {
        'claude' { return (Get-FbClaudePath) }
        'codex' { return (Get-FbCodexPath) }
        'claude-desktop' { return (Get-FbClaudeDesktopDir) }
    }
    return $null
}

function Install-FbHarnessByWinget {
    param([string]$WingetId)
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) { return $false }
    $common = @('--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity')
    $p = Start-FbQuietProcess -FilePath $winget.Source -Wait `
        -ArgumentList (@('install', '-e', '--id', $WingetId) + $common + @('--scope', 'user'))
    if ($p.ExitCode -ne 0) {
        # --scope user 를 받지 않는 패키지가 있다. 한 번 더 시도한다.
        $p = Start-FbQuietProcess -FilePath $winget.Source -Wait `
            -ArgumentList (@('install', '-e', '--id', $WingetId) + $common)
    }
    return ($p.ExitCode -eq 0)
}

function Install-FbHarnessByScript {
    param([string]$ScriptUrl, [string]$Id)
    if ([string]::IsNullOrWhiteSpace($ScriptUrl)) { return $false }
    Initialize-FbHome
    $file = Join-Path $env:TEMP ('fb-install-{0}-{1}.ps1' -f $Id, (Get-FbTimestamp))
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $ScriptUrl -OutFile $file -ErrorAction Stop
    } catch {
        return $false
    }
    $stamp = Get-FbTimestamp
    $outLog = Join-Path (Get-FbLogDir) ('harness-{0}-{1}.log' -f $Id, $stamp)
    $errLog = Join-Path (Get-FbLogDir) ('harness-{0}-{1}.err.log' -f $Id, $stamp)
    $ps = (Get-Command powershell.exe).Source
    $p = Start-FbQuietProcess -FilePath $ps -Wait -StdOutPath $outLog -StdErrPath $errLog `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $file)
    Clear-FbTempFile -Path $file
    return ($p.ExitCode -eq 0)
}

function Install-FbHarness {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('claude', 'codex', 'claude-desktop')]
        [string]$Id
    )
    $entry = Get-FbHarnessEntry -Id $Id
    $result = [pscustomobject]@{
        Id         = $Id
        Name       = $entry.Name
        Ok         = $false
        Method     = 'none'
        Path       = $null
        NeedsLogin = $false
        Detail     = ''
        ManualUrl  = $entry.ManualUrl
    }

    $existing = Get-FbHarnessPath -Id $Id
    if ($existing) {
        $result.Ok = $true
        $result.Method = 'already'
        $result.Path = $existing
        $result.Detail = "$($entry.Name) 은 이미 설치돼 있습니다."
        return $result
    }

    $tried = @()
    if (Install-FbHarnessByWinget -WingetId $entry.WingetId) {
        Update-FbEnvPath
        $found = Get-FbHarnessPath -Id $Id
        if ($found) {
            $result.Ok = $true
            $result.Method = 'winget'
            $result.Path = $found
            $result.NeedsLogin = $true
            $result.Detail = "$($entry.Name) 을 winget 으로 설치했습니다. $($entry.LoginNote)"
            return $result
        }
    }
    $tried += 'winget'

    if ($entry.ScriptUrl) {
        $tried += '공식 설치 스크립트'
        if (Install-FbHarnessByScript -ScriptUrl $entry.ScriptUrl -Id $Id) {
            Update-FbEnvPath
            $found = Get-FbHarnessPath -Id $Id
            if ($found) {
                $result.Ok = $true
                $result.Method = 'script'
                $result.Path = $found
                $result.NeedsLogin = $true
                $result.Detail = "$($entry.Name) 을 공식 설치 스크립트로 설치했습니다. $($entry.LoginNote)"
                return $result
            }
        }
    }

    $result.Detail = ("$($entry.Name) 을 자동으로 설치하지 못했습니다 (시도: " + ($tried -join ', ') +
        "). 회사 네트워크나 백신이 막았을 수 있습니다. " + $entry.ManualUrl + " 에서 직접 설치하세요.")
    return $result
}

# 로그인은 사람이 해야 한다. 이 창만은 일부러 보이게 띄운다.
function Start-FbHarnessLogin {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('claude', 'codex', 'claude-desktop')]
        [string]$Id
    )
    $entry = Get-FbHarnessEntry -Id $Id
    $path = Get-FbHarnessPath -Id $Id
    if (-not $path) { return "$($entry.Name) 이 아직 설치되지 않았습니다." }

    if ($Id -eq 'claude-desktop') {
        Start-Process $entry.ManualUrl | Out-Null
        return 'Claude Desktop 을 열고 로그인하세요.'
    }

    $cmd = '& "' + $path + '"'
    if ($entry.LoginArgs.Count -gt 0) { $cmd = $cmd + ' ' + ($entry.LoginArgs -join ' ') }
    $ps = (Get-Command powershell.exe).Source
    Start-Process -FilePath $ps -ArgumentList @('-NoExit', '-NoProfile', '-Command', $cmd) | Out-Null
    return "로그인 창을 열었습니다. $($entry.LoginNote)"
}

# 없는 하네스를 깔고 MCP 등록까지 이어서 한다.
function Install-FbHarnesses {
    param([string[]]$Ids)
    $results = New-Object System.Collections.Generic.List[object]
    foreach ($id in @($Ids)) {
        $results.Add((Install-FbHarness -Id $id))
    }
    if (@($results | Where-Object { $_.Ok -and $_.Method -ne 'already' }).Count -gt 0) {
        if (Test-FbPackagesPresent) { [void](Connect-FbHarnesses) }
    }
    return @($results)
}
