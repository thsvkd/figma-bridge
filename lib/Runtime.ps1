#Requires -Version 5.1
# Bun install + pinned npm packages under %LOCALAPPDATA%\FigmaBridge.

. (Join-Path $PSScriptRoot 'Common.ps1')

# 중계 서버는 우리 릴레이(lib/relay.js)가 맡는다. 패키지는 MCP 서버만 필요하다.
function Test-FbPackagesPresent {
    return (Test-Path -LiteralPath (Get-FbMcpServerJs))
}

function Install-FbBun {
    param([switch]$DryRun)
    $existing = Get-FbBunPath
    if ($existing) { return $existing }
    if ($DryRun) { return $null }

    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if ($winget) {
        $args = @('install', '-e', '--id', 'Oven-sh.Bun', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity')
        $p = Start-FbQuietProcess -FilePath $winget.Source -ArgumentList $args -Wait
        if ($p.ExitCode -eq 0) {
            Update-FbEnvPath
            $found = Get-FbBunPath
            if ($found) { return $found }
        }
    }

    $install = Join-Path $env:TEMP 'bun-install.ps1'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://bun.sh/install.ps1' -OutFile $install
    $ps = (Get-Command powershell.exe).Source
    [void](Start-FbQuietProcess -FilePath $ps -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $install) -Wait)
    Update-FbEnvPath
    return (Get-FbBunPath)
}

function Install-FbPackages {
    param([switch]$DryRun)
    if (Test-FbPackagesPresent) { return $true }
    if ($DryRun) { return $false }

    Initialize-FbHome
    $srcPkg = Join-Path (Get-FbCodeRoot) 'package.json'
    $dstPkg = Join-Path (Get-FbHome) 'package.json'
    if (-not (Test-Path -LiteralPath $srcPkg)) {
        throw "package.json 이 없습니다: $srcPkg"
    }
    Copy-Item -LiteralPath $srcPkg -Destination $dstPkg -Force

    $bun = Get-FbBunPath
    if (-not $bun) { $bun = Install-FbBun }
    if (-not $bun) { throw 'Bun 을 설치하지 못했습니다. 중계 서버를 띄울 수 없습니다.' }

    Initialize-FbHome
    $outLog = Join-Path (Get-FbLogDir) 'bun-install.out.log'
    $errLog = Join-Path (Get-FbLogDir) 'bun-install.err.log'
    $p = Start-FbQuietProcess -FilePath $bun -ArgumentList @('install') -WorkingDirectory (Get-FbHome) `
        -StdOutPath $outLog -StdErrPath $errLog -Wait
    if ($p.ExitCode -ne 0) {
        $tail = ''
        if (Test-Path -LiteralPath $errLog) { $tail = [IO.File]::ReadAllText($errLog) }
        throw "bun install 실패 (exit $($p.ExitCode)) $tail"
    }

    if (-not (Test-FbPackagesPresent)) {
        throw 'Talk to Figma 패키지 설치 후에도 파일이 없습니다.'
    }
    return $true
}

function Get-FbMcpLaunch {
    $serverJs = Get-FbMcpServerJs
    $bun = Get-FbBunPath
    $node = Get-FbNodePath
    if ($bun -and (Test-Path -LiteralPath $serverJs)) {
        return [pscustomobject]@{ Command = $bun; Arguments = @($serverJs) }
    }
    if ($node -and (Test-Path -LiteralPath $serverJs)) {
        return [pscustomobject]@{ Command = $node; Arguments = @($serverJs) }
    }
    return $null
}
