#Requires -Version 5.1
# Claude Code / Claude Desktop / Codex MCP entries for TalkToFigma.

. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot 'Runtime.ps1')

function Set-FbJsonMcpEntry {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    $dir = Split-Path $Path -Parent
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    $obj = $null
    if (Test-Path -LiteralPath $Path) {
        Backup-FbFile -Path $Path | Out-Null
        $obj = Read-FbJsonFile -Path $Path
    }
    if ($null -eq $obj) { $obj = [pscustomobject]@{} }

    $servers = $null
    if ($obj.PSObject.Properties.Name -contains 'mcpServers') {
        $servers = $obj.mcpServers
    }
    if ($null -eq $servers) {
        $obj | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([pscustomobject]@{}) -Force
        $servers = $obj.mcpServers
    }

    $entry = [pscustomobject]@{
        command = $Command
        args    = @($Arguments)
    }
    $servers | Add-Member -NotePropertyName $Name -NotePropertyValue $entry -Force
    Save-FbJsonFile -Path $Path -Object $obj
}

function Remove-FbJsonMcpEntry {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name
    )
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    $obj = Read-FbJsonFile -Path $Path
    if ($null -eq $obj) { return $false }
    if ($obj.PSObject.Properties.Name -notcontains 'mcpServers') { return $false }
    $servers = $obj.mcpServers
    if ($null -eq $servers) { return $false }
    if ($servers.PSObject.Properties.Name -notcontains $Name) { return $false }
    Backup-FbFile -Path $Path | Out-Null
    $servers.PSObject.Properties.Remove($Name)
    Save-FbJsonFile -Path $Path -Object $obj
    return $true
}

function Test-FbJsonMcpEntry {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name,
        [string]$Command
    )
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    $obj = Read-FbJsonFile -Path $Path
    if ($null -eq $obj -or $null -eq $obj.mcpServers) { return $false }
    $entry = $obj.mcpServers.$Name
    if ($null -eq $entry) { return $false }
    if ([string]::IsNullOrWhiteSpace($Command)) { return $true }
    return ([string]$entry.command -eq $Command)
}

function Invoke-FbNative {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList,
        [int]$TimeoutSec = 45
    )
    $out = Join-Path $env:TEMP ('fb-out-{0}.txt' -f [guid]::NewGuid().ToString('N'))
    $err = Join-Path $env:TEMP ('fb-err-{0}.txt' -f [guid]::NewGuid().ToString('N'))
    try {
        $p = Start-FbQuietProcess -FilePath $FilePath -ArgumentList $ArgumentList -Wait `
            -StdOutPath $out -StdErrPath $err
        $stdout = ''
        $stderr = ''
        if (Test-Path -LiteralPath $out) { $stdout = [IO.File]::ReadAllText($out) }
        if (Test-Path -LiteralPath $err) { $stderr = [IO.File]::ReadAllText($err) }
        return [pscustomobject]@{
            ExitCode = $p.ExitCode
            StdOut   = $stdout
            StdErr   = $stderr
        }
    } finally {
        Remove-Item -LiteralPath $out, $err -Force -ErrorAction SilentlyContinue
    }
}

function Add-FbClaudeUserMcp {
    param($Launch)
    $claude = Get-FbClaudePath
    if (-not $claude) { return [pscustomobject]@{ Ok = $false; Detail = 'Claude Code 가 없습니다.' } }

    [void](Invoke-FbNative -FilePath $claude -ArgumentList @('mcp', 'remove', $script:FbMcpName, '-s', 'user'))
    $args = @('mcp', 'add', '--scope', 'user', '--transport', 'stdio', $script:FbMcpName, '--', $Launch.Command)
    foreach ($a in @($Launch.Arguments)) { $args += $a }
    $r = Invoke-FbNative -FilePath $claude -ArgumentList $args
    if ($r.ExitCode -ne 0) {
        return [pscustomobject]@{ Ok = $false; Detail = ($r.StdErr + $r.StdOut).Trim() }
    }
    return [pscustomobject]@{ Ok = $true; Detail = 'Claude Code 사용자 범위에 등록했습니다.' }
}

function Remove-FbClaudeUserMcp {
    $claude = Get-FbClaudePath
    if (-not $claude) { return $false }
    $r = Invoke-FbNative -FilePath $claude -ArgumentList @('mcp', 'remove', $script:FbMcpName, '-s', 'user')
    return ($r.ExitCode -eq 0)
}

function Test-FbClaudeUserMcp {
    $claude = Get-FbClaudePath
    if (-not $claude) { return $false }
    $r = Invoke-FbNative -FilePath $claude -ArgumentList @('mcp', 'get', $script:FbMcpName)
    if ($r.ExitCode -ne 0) { return $false }
    $text = $r.StdOut + $r.StdErr
    return ($text -match $script:FbMcpName)
}

function Add-FbCodexMcp {
    param($Launch)
    $codex = Get-FbCodexPath
    if (-not $codex) { return [pscustomobject]@{ Ok = $false; Detail = 'Codex 가 없습니다.' } }

    $exe = $codex
    $prefix = @()
    if ($codex -match '\.ps1$') {
        $exe = (Get-Command powershell.exe).Source
        $prefix = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $codex)
    } elseif ($codex -match '\.cmd$') {
        $exe = $codex
    }

    $removeArgs = $prefix + @('mcp', 'remove', $script:FbMcpName)
    [void](Invoke-FbNative -FilePath $exe -ArgumentList $removeArgs)

    $addArgs = $prefix + @('mcp', 'add', $script:FbMcpName, '--', $Launch.Command)
    foreach ($a in @($Launch.Arguments)) { $addArgs += $a }
    $r = Invoke-FbNative -FilePath $exe -ArgumentList $addArgs
    if (Test-FbCodexMcp) {
        return [pscustomobject]@{ Ok = $true; Detail = 'Codex 에 등록했습니다.' }
    }
    try {
        Set-FbCodexTomlEntry -Launch $Launch
    } catch {
        $msg = ($r.StdErr + $r.StdOut + ' ' + $_.Exception.Message).Trim()
        return [pscustomobject]@{ Ok = $false; Detail = $msg }
    }
    if (Test-FbCodexMcp) {
        return [pscustomobject]@{ Ok = $true; Detail = 'Codex config.toml 에 직접 넣었습니다.' }
    }
    return [pscustomobject]@{ Ok = $false; Detail = ($r.StdErr + $r.StdOut).Trim() }
}

function Remove-FbCodexMcp {
    $codex = Get-FbCodexPath
    $ok = $false
    if ($codex) {
        $exe = $codex
        $prefix = @()
        if ($codex -match '\.ps1$') {
            $exe = (Get-Command powershell.exe).Source
            $prefix = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $codex)
        }
        $r = Invoke-FbNative -FilePath $exe -ArgumentList ($prefix + @('mcp', 'remove', $script:FbMcpName))
        if ($r.ExitCode -eq 0) { $ok = $true }
    }
    $path = Get-FbCodexConfigPath
    if (Test-Path -LiteralPath $path) {
        $raw = [IO.File]::ReadAllText($path)
        if ($raw -match [regex]::Escape($script:FbMarkerBegin)) {
            Backup-FbFile -Path $path | Out-Null
            $raw = [regex]::Replace($raw, "(?s)`r?`n?" + [regex]::Escape($script:FbMarkerBegin) + ".*?" + [regex]::Escape($script:FbMarkerEnd), '')
            $utf8 = New-Object System.Text.UTF8Encoding $false
            [IO.File]::WriteAllText($path, $raw, $utf8)
            $ok = $true
        }
    }
    return $ok
}

function Test-FbCodexMcp {
    $path = Get-FbCodexConfigPath
    if (-not (Test-Path -LiteralPath $path)) { return $false }
    $raw = [IO.File]::ReadAllText($path)
    return ($raw -match '\[mcp_servers\.TalkToFigma\]' -or
            $raw -match '\[mcp_servers\."TalkToFigma"\]' -or
            $raw -match 'mcp_servers\.TalkToFigma')
}

function Set-FbCodexTomlEntry {
    param($Launch)
    $path = Get-FbCodexConfigPath
    $dir = Split-Path $path -Parent
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $raw = ''
    if (Test-Path -LiteralPath $path) {
        Backup-FbFile -Path $path | Out-Null
        $raw = [IO.File]::ReadAllText($path)
    }
    $cmd = ([string]$Launch.Command).Replace('\', '\\').Replace("'", "''")
    $argList = @()
    foreach ($a in @($Launch.Arguments)) {
        $argList += ("'{0}'" -f ([string]$a).Replace('\', '\\').Replace("'", "''"))
    }
    $block = @(
        $script:FbMarkerBegin
        '[mcp_servers.TalkToFigma]'
        "command = '$cmd'"
        ('args = [{0}]' -f ($argList -join ', '))
        $script:FbMarkerEnd
    ) -join "`r`n"

    if ($raw -match [regex]::Escape($script:FbMarkerBegin)) {
        $raw = [regex]::Replace($raw, "(?s)" + [regex]::Escape($script:FbMarkerBegin) + ".*?" + [regex]::Escape($script:FbMarkerEnd), $block)
    } elseif ($raw -match '\[mcp_servers\.TalkToFigma\]') {
        $raw = $raw.TrimEnd() + "`r`n`r`n" + $block + "`r`n"
    } else {
        $raw = $raw.TrimEnd() + "`r`n`r`n" + $block + "`r`n"
    }
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [IO.File]::WriteAllText($path, $raw, $utf8)
}

function Connect-FbHarnesses {
    param([switch]$DryRun)
    $launch = Get-FbMcpLaunch
    if ($null -eq $launch) { throw 'Talk to Figma MCP 파일을 아직 준비하지 못했습니다.' }

    $results = @()
    $state = Get-FbState
    if ($null -eq $state.owned) {
        $state | Add-Member -NotePropertyName owned -NotePropertyValue ([pscustomobject]@{ claudeUser = $false; claudeDesktop = $false; codex = $false }) -Force
    }

    $claude = Get-FbClaudePath
    if ($claude) {
        if ($DryRun) {
            $results += [pscustomobject]@{ Target = 'Claude Code'; Ok = $true; Detail = '등록할 수 있습니다.' }
        } else {
            $r = Add-FbClaudeUserMcp -Launch $launch
            $results += [pscustomobject]@{ Target = 'Claude Code'; Ok = $r.Ok; Detail = $r.Detail }
            if ($r.Ok) { $state.owned.claudeUser = $true }
        }
    } else {
        $results += [pscustomobject]@{ Target = 'Claude Code'; Ok = $false; Detail = '설치되어 있지 않습니다.' }
    }

    $desktop = Get-FbClaudeDesktopConfigPath
    $desktopDir = Split-Path $desktop -Parent
    if (Test-Path -LiteralPath $desktopDir) {
        if ($DryRun) {
            $results += [pscustomobject]@{ Target = 'Claude Desktop'; Ok = $true; Detail = '설정 파일을 쓸 수 있습니다.' }
        } else {
            try {
                Set-FbJsonMcpEntry -Path $desktop -Name $script:FbMcpName -Command $launch.Command -Arguments $launch.Arguments
                $state.owned.claudeDesktop = $true
                $results += [pscustomobject]@{ Target = 'Claude Desktop'; Ok = $true; Detail = '설정에 넣었습니다. 앱을 한 번 재시작하세요.' }
            } catch {
                $results += [pscustomobject]@{ Target = 'Claude Desktop'; Ok = $false; Detail = $_.Exception.Message }
            }
        }
    } else {
        $results += [pscustomobject]@{ Target = 'Claude Desktop'; Ok = $false; Detail = '앱이 없습니다.' }
    }

    $codex = Get-FbCodexPath
    if ($codex) {
        if ($DryRun) {
            $results += [pscustomobject]@{ Target = 'Codex'; Ok = $true; Detail = '등록할 수 있습니다.' }
        } else {
            $r = Add-FbCodexMcp -Launch $launch
            $results += [pscustomobject]@{ Target = 'Codex'; Ok = $r.Ok; Detail = $r.Detail }
            if ($r.Ok) { $state.owned.codex = $true }
        }
    } else {
        $results += [pscustomobject]@{ Target = 'Codex'; Ok = $false; Detail = '설치되어 있지 않습니다.' }
    }

    if (-not $DryRun) {
        $state.lastConnect = (Get-Date).ToString('o')
        Save-FbState -State $state
    }
    return $results
}

function Disconnect-FbHarnesses {
    param([switch]$DryRun)
    $results = @()
    $state = Get-FbState

    if ($DryRun) {
        $results += [pscustomobject]@{ Target = 'Claude Code'; Ok = $true; Detail = '제거할 수 있습니다.' }
        $results += [pscustomobject]@{ Target = 'Claude Desktop'; Ok = $true; Detail = '제거할 수 있습니다.' }
        $results += [pscustomobject]@{ Target = 'Codex'; Ok = $true; Detail = '제거할 수 있습니다.' }
        return $results
    }

    if (Get-FbClaudePath) {
        $ok = Remove-FbClaudeUserMcp
        $results += [pscustomobject]@{ Target = 'Claude Code'; Ok = $ok; Detail = $(if ($ok) { '뺐습니다.' } else { '없거나 제거에 실패했습니다.' }) }
    }
    $desktop = Get-FbClaudeDesktopConfigPath
    if (Test-Path -LiteralPath $desktop) {
        $ok = Remove-FbJsonMcpEntry -Path $desktop -Name $script:FbMcpName
        $results += [pscustomobject]@{ Target = 'Claude Desktop'; Ok = $true; Detail = $(if ($ok) { '뺐습니다.' } else { '항목이 없었습니다.' }) }
    }
    if (Get-FbCodexPath) {
        $ok = Remove-FbCodexMcp
        $results += [pscustomobject]@{ Target = 'Codex'; Ok = $ok; Detail = $(if ($ok) { '뺐습니다.' } else { '없거나 제거에 실패했습니다.' }) }
    }

    if ($state.owned) {
        $state.owned.claudeUser = $false
        $state.owned.claudeDesktop = $false
        $state.owned.codex = $false
        Save-FbState -State $state
    }
    return $results
}
