#Requires -Version 5.1
# Dot-source only. Shared paths, JSON helpers, process lookup.

if (Get-Variable -Name FigmaBridgeCommonLoaded -Scope Script -ErrorAction SilentlyContinue) {
    if ($script:FigmaBridgeCommonLoaded) { return }
}
$script:FigmaBridgeCommonLoaded = $true

$script:FbProductName = '피그마 연결'
$script:FbMcpName = 'TalkToFigma'
$script:FbPort = 3055
$script:FbPkgVer = '0.3.5'
$script:FbMcpPkg = 'cursor-talk-to-figma-mcp'
$script:FbSocketPkg = 'cursor-talk-to-figma-socket'
$script:FbPluginUrl = 'https://www.figma.com/community/plugin/1485687494525374295/talk-to-figma-mcp-plugin'
$script:FbChannelHint = 'figma'
$script:FbPluginName = 'Talk To Figma MCP Plugin'
$script:FbMarkerBegin = '# >>> figma-bridge TalkToFigma >>>'
$script:FbMarkerEnd = '# <<< figma-bridge TalkToFigma <<<'

$script:FbCodeRoot = Split-Path $PSScriptRoot -Parent
if (-not [string]::IsNullOrWhiteSpace($env:FIGMA_BRIDGE_HOME)) {
    $script:FbHome = $env:FIGMA_BRIDGE_HOME
} else {
    $script:FbHome = Join-Path $env:LOCALAPPDATA 'FigmaBridge'
}

function Get-FbCodeRoot { return $script:FbCodeRoot }
function Get-FbHome { return $script:FbHome }
function Get-FbLogDir { return (Join-Path $script:FbHome 'logs') }
function Get-FbStatePath { return (Join-Path $script:FbHome 'state.json') }
function Get-FbPidPath { return (Join-Path $script:FbHome 'socket.pid') }

function Initialize-FbHome {
    foreach ($dir in @($script:FbHome, (Get-FbLogDir), (Join-Path $script:FbHome 'backups'))) {
        if (-not (Test-Path -LiteralPath $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }
    }
}

function Write-FbLine {
    param(
        [ValidateSet('ok', 'warn', 'err', 'info', 'step')]
        [string]$Kind = 'info',
        [string]$Label,
        [string]$Text
    )
    $tag = switch ($Kind) {
        'ok' { 'OK' }
        'warn' { '!!' }
        'err' { 'XX' }
        'step' { '>>' }
        default { '..' }
    }
    $line = "[{0}] {1}" -f $tag, $Label
    if (-not [string]::IsNullOrWhiteSpace($Text)) { $line = "$line  $Text" }
    Write-Host $line
}

function Get-FbTimestamp {
    return (Get-Date).ToString('yyyyMMdd-HHmmss')
}

function Backup-FbFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    Initialize-FbHome
    $name = [IO.Path]::GetFileName($Path)
    $dest = Join-Path (Join-Path $script:FbHome 'backups') ("{0}.{1}.bak" -f $name, (Get-FbTimestamp))
    Copy-Item -LiteralPath $Path -Destination $dest -Force
    return $dest
}

function Read-FbJsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $raw = [IO.File]::ReadAllText($Path)
    if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
    return ($raw | ConvertFrom-Json)
}

function Save-FbJsonFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Object
    )
    $dir = Split-Path $Path -Parent
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $json = $Object | ConvertTo-Json -Depth 30
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [IO.File]::WriteAllText($Path, $json, $utf8)
}

function Get-FbState {
    Initialize-FbHome
    $path = Get-FbStatePath
    $state = Read-FbJsonFile -Path $path
    if ($null -eq $state) {
        $state = [pscustomobject]@{
            version     = 1
            owned       = [pscustomobject]@{ claudeUser = $false; claudeDesktop = $false; codex = $false }
            socketPid   = $null
            lastConnect = $null
        }
    }
    return $state
}

function Save-FbState {
    param($State)
    Initialize-FbHome
    Save-FbJsonFile -Path (Get-FbStatePath) -Object $State
}

function Test-FbPortOpen {
    param([int]$Port = 3055)
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(400)
        if ($ok -and $client.Connected) {
            $client.Close()
            return $true
        }
        $client.Close()
        return $false
    } catch {
        return $false
    }
}

function Get-FbHttpText {
    param(
        [string]$Url = 'http://127.0.0.1:3055/',
        [int]$TimeoutMs = 800
    )
    try {
        $req = [System.Net.HttpWebRequest]::Create($Url)
        $req.Method = 'GET'
        $req.Timeout = $TimeoutMs
        $req.ReadWriteTimeout = $TimeoutMs
        $resp = $req.GetResponse()
        try {
            $reader = New-Object IO.StreamReader ($resp.GetResponseStream())
            try { return $reader.ReadToEnd() } finally { $reader.Close() }
        } finally { $resp.Close() }
    } catch {
        return $null
    }
}

function Find-FbCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string[]]$Candidates
    )
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) {
        $src = [string]$cmd.Source
        if (-not [string]::IsNullOrWhiteSpace($src) -and (Test-Path -LiteralPath $src)) {
            return $src
        }
    }
    foreach ($p in @($Candidates)) {
        if (-not [string]::IsNullOrWhiteSpace($p) -and (Test-Path -LiteralPath $p)) {
            return $p
        }
    }
    return $null
}

function Get-FbFigmaPath {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Figma\Figma.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Figma\Figma.exe'),
        (Join-Path ${env:ProgramFiles} 'Figma\Figma.exe')
    )
    return (Find-FbCommand -Name 'Figma' -Candidates $candidates)
}

function Test-FbFigmaRunning {
    $procs = @(Get-Process -Name 'Figma', 'FigmaRenderer' -ErrorAction SilentlyContinue)
    return ($procs.Count -gt 0)
}

function Get-FbClaudePath {
    $candidates = @(
        (Join-Path $env:USERPROFILE '.local\bin\claude.exe'),
        (Join-Path $env:USERPROFILE '.local\bin\claude.cmd')
    )
    return (Find-FbCommand -Name 'claude' -Candidates $candidates)
}

function Get-FbCodexPath {
    $candidates = @(
        (Join-Path $env:APPDATA 'npm\codex.cmd'),
        (Join-Path $env:APPDATA 'npm\codex.ps1'),
        (Join-Path $env:LOCALAPPDATA 'Programs\OpenAI\Codex\bin\codex.exe'),
        (Join-Path $env:USERPROFILE '.codex\packages\standalone\current\bin\codex.exe')
    )
    return (Find-FbCommand -Name 'codex' -Candidates $candidates)
}

function Get-FbBunPath {
    $candidates = @(
        (Join-Path $env:USERPROFILE '.bun\bin\bun.exe'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\bun.exe')
    )
    return (Find-FbCommand -Name 'bun' -Candidates $candidates)
}

function Get-FbNodePath {
    $candidates = @(
        (Join-Path ${env:ProgramFiles} 'nodejs\node.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\node\node.exe')
    )
    return (Find-FbCommand -Name 'node' -Candidates $candidates)
}

function Get-FbNpmPath {
    $candidates = @(
        (Join-Path ${env:ProgramFiles} 'nodejs\npm.cmd'),
        (Join-Path $env:APPDATA 'npm\npm.cmd')
    )
    return (Find-FbCommand -Name 'npm' -Candidates $candidates)
}

function Get-FbClaudeDesktopConfigPath {
    return (Join-Path $env:APPDATA 'Claude\claude_desktop_config.json')
}

function Get-FbCodexConfigPath {
    return (Join-Path $env:USERPROFILE '.codex\config.toml')
}

function Get-FbMcpServerJs {
    return (Join-Path $script:FbHome "node_modules\$($script:FbMcpPkg)\dist\server.js")
}

function Get-FbSocketJs {
    return (Join-Path $script:FbHome "node_modules\$($script:FbSocketPkg)\dist\socket.js")
}

function Get-FbRelayJs {
    return (Join-Path $script:FbCodeRoot 'lib\relay.js')
}

# 릴레이가 우리 것이면 /status 가 JSON 을 준다. 아니면 $null 이다.
function Get-FbRelayStatus {
    $raw = Get-FbHttpText -Url ("http://127.0.0.1:{0}/status" -f $script:FbPort)
    if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
    try { $obj = $raw | ConvertFrom-Json } catch { return $null }
    if ($obj.relay -ne 'figma-bridge') { return $null }
    return $obj
}

function Format-FbArgument {
    param([string]$Value)
    if ($Value -match '[\s"]') { return '"' + ($Value -replace '"', '\"') + '"' }
    return $Value
}

# 콘솔 창을 아예 만들지 않고 프로세스를 실행한다.
# Start-Process 는 -WindowStyle Hidden 이어도 콘솔 창을 할당해 깜빡일 수 있다.
function Start-FbQuietProcess {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [string]$WorkingDirectory,
        [hashtable]$Environment,
        [string]$StdOutPath,
        [string]$StdErrPath,
        [switch]$Wait
    )
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.Arguments = (@($ArgumentList) | ForEach-Object { Format-FbArgument -Value $_ }) -join ' '
    if ($WorkingDirectory) { $psi.WorkingDirectory = $WorkingDirectory }
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    if ($Environment) {
        foreach ($k in $Environment.Keys) { $psi.EnvironmentVariables[$k] = [string]$Environment[$k] }
    }

    # 파이프는 기다리는 호출에서만 쓴다. 백그라운드 프로세스는 자기 로그를 직접 쓴다.
    $capture = [bool]($Wait -and ($StdOutPath -or $StdErrPath))
    $psi.RedirectStandardOutput = $capture
    $psi.RedirectStandardError = $capture

    $proc = [System.Diagnostics.Process]::Start($psi)
    if (-not $capture) {
        if ($Wait) { $proc.WaitForExit() }
        return $proc
    }

    $outTask = $proc.StandardOutput.ReadToEndAsync()
    $errTask = $proc.StandardError.ReadToEndAsync()
    $proc.WaitForExit()
    $utf8 = New-Object System.Text.UTF8Encoding $false
    if ($StdOutPath) { [IO.File]::WriteAllText($StdOutPath, $outTask.Result, $utf8) }
    if ($StdErrPath) { [IO.File]::WriteAllText($StdErrPath, $errTask.Result, $utf8) }
    return $proc
}

function Get-FbShortcutPaths {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $start = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
    return @(
        [pscustomobject]@{ Kind = 'Desktop'; Path = (Join-Path $desktop ($script:FbProductName + '.lnk')) },
        [pscustomobject]@{ Kind = 'StartMenu'; Path = (Join-Path $start ($script:FbProductName + '.lnk')) }
    )
}

function Write-FbLog {
    param([string]$Name, [string]$Text)
    Initialize-FbHome
    $path = Join-Path (Get-FbLogDir) ("{0}-{1}.log" -f $Name, (Get-FbTimestamp))
    $utf8 = New-Object System.Text.UTF8Encoding $true
    [IO.File]::WriteAllText($path, $Text, $utf8)
    return $path
}

function ConvertTo-FbHashtable {
    param($Object)
    if ($null -eq $Object) { return @{} }
    if ($Object -is [hashtable]) { return $Object }
    $ht = @{}
    foreach ($p in $Object.PSObject.Properties) {
        $ht[$p.Name] = $p.Value
    }
    return $ht
}
