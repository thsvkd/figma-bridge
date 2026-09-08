#Requires -Version 5.1
# Bun install + pinned npm packages under %LOCALAPPDATA%\FigmaBridge.

. (Join-Path $PSScriptRoot 'Common.ps1')

function Test-FbPackagesPresent {
    return (Test-Path -LiteralPath (Get-FbMcpServerJs)) -and (Test-Path -LiteralPath (Get-FbSocketJs))
}

function Install-FbBun {
    param([switch]$DryRun)
    $existing = Get-FbBunPath
    if ($existing) { return $existing }
    if ($DryRun) { return $null }

    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if ($winget) {
        $args = @('install', '-e', '--id', 'Oven-sh.Bun', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity')
        $p = Start-Process -FilePath $winget.Source -ArgumentList $args -Wait -PassThru -WindowStyle Hidden
        if ($p.ExitCode -eq 0) {
            $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
            $found = Get-FbBunPath
            if ($found) { return $found }
        }
    }

    $install = Join-Path $env:TEMP 'bun-install.ps1'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://bun.sh/install.ps1' -OutFile $install
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $install
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    $homeBun = Join-Path $env:USERPROFILE '.bun\bin'
    if ($env:Path -notlike "*$homeBun*") { $env:Path = "$homeBun;$env:Path" }
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
    $p = Start-Process -FilePath $bun -ArgumentList @('install') -WorkingDirectory (Get-FbHome) `
        -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog
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
