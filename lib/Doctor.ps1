#Requires -Version 5.1
# Deterministic checks + safe fixes. AI harness is a fallback, not the first pass.

. (Join-Path $PSScriptRoot 'Engine.ps1')

function New-FbCheck {
    param(
        [string]$Id,
        [string]$Label,
        [ValidateSet('ok', 'warn', 'fail')]
        [string]$Status,
        [string]$Text,
        [string]$Hint = '',
        [string]$FixId = '',
        [switch]$CanFix
    )
    [pscustomobject]@{
        Id     = $Id
        Label  = $Label
        Status = $Status
        Text   = [string]$Text
        Hint   = $Hint
        CanFix = [bool]$CanFix
        FixId  = $FixId
    }
}

function Get-FbChecks {
    $checks = @()

    $bun = Get-FbBunPath
    if ($bun) {
        $checks += New-FbCheck -Id 'bun' -Label 'Bun' -Status 'ok' -Text ([string]$bun)
    } else {
        $checks += New-FbCheck -Id 'bun' -Label 'Bun' -Status 'fail' -Text '없음' `
            -Hint '중계 서버는 Bun 으로 뜹니다. 점검이 설치를 시도합니다.' -CanFix -FixId 'install-bun'
    }

    if (Test-FbPackagesPresent) {
        $checks += New-FbCheck -Id 'packages' -Label 'Talk to Figma 패키지' -Status 'ok' -Text ([string](Get-FbMcpServerJs))
    } else {
        $checks += New-FbCheck -Id 'packages' -Label 'Talk to Figma 패키지' -Status 'fail' -Text '미설치' `
            -Hint '연결 시 로컬에 고정 버전을 받습니다.' -CanFix -FixId 'install-packages'
    }

    $sock = Get-FbSocketStatus
    if ($sock.HttpOk -and $sock.IsOurs) {
        $text = '127.0.0.1:3055 응답'
        if ($sock.Pid) { $text = "$text (PID $($sock.Pid))" }
        $checks += New-FbCheck -Id 'socket' -Label '중계 서버' -Status 'ok' -Text $text
    } elseif ($sock.HttpOk) {
        $checks += New-FbCheck -Id 'socket' -Label '중계 서버' -Status 'warn' -Text '다른 중계 서버가 3055 를 쓰는 중입니다' `
            -Hint '우리 릴레이라야 채널을 맞출 필요가 없습니다.' -CanFix -FixId 'restart-socket'
    } elseif ($sock.PortOpen) {
        $checks += New-FbCheck -Id 'socket' -Label '중계 서버' -Status 'warn' -Text '포트는 열려 있으나 HTTP 응답이 아닙니다' `
            -Hint '다른 프로그램이 3055 를 쓰는 중일 수 있습니다.' -CanFix -FixId 'restart-socket'
    } else {
        $checks += New-FbCheck -Id 'socket' -Label '중계 서버' -Status 'fail' -Text '꺼져 있음' `
            -Hint '연결 또는 점검이 중계 서버를 켭니다.' -CanFix -FixId 'start-socket'
    }

    $figma = Get-FbFigmaPath
    if ($figma) {
        if (Test-FbFigmaRunning) {
            $checks += New-FbCheck -Id 'figma' -Label '피그마 앱' -Status 'ok' -Text ([string]$figma)
        } else {
            $checks += New-FbCheck -Id 'figma' -Label '피그마 앱' -Status 'warn' -Text '설치됨 · 실행 중 아님' `
                -Hint '플러그인을 쓰려면 피그마를 켜야 합니다.' -CanFix -FixId 'start-figma'
        }
    } else {
        $checks += New-FbCheck -Id 'figma' -Label '피그마 앱' -Status 'fail' -Text '미설치' `
            -Hint 'https://www.figma.com/downloads/ 에서 데스크톱 앱을 설치하세요.'
    }

    if ($sock.PluginConnected) {
        $checks += New-FbCheck -Id 'plugin' -Label '피그마 플러그인' -Status 'ok' -Text '중계 서버에 붙어 있습니다'
    } else {
        $hint = '피그마에서 디자인 파일을 연 상태여야 합니다. 고치기를 누르면 창을 앞으로 꺼내 플러그인을 대신 켭니다.'
        $checks += New-FbCheck -Id 'plugin' -Label '피그마 플러그인' -Status 'warn' -Text '아직 안 붙음' `
            -Hint $hint -CanFix -FixId 'start-plugin'
    }

    $claude = Get-FbClaudePath
    if ($claude) {
        if (Test-FbClaudeUserMcp) {
            $checks += New-FbCheck -Id 'claude' -Label 'Claude Code' -Status 'ok' -Text ([string]$claude)
        } else {
            $checks += New-FbCheck -Id 'claude' -Label 'Claude Code' -Status 'fail' -Text '앱은 있으나 TalkToFigma 미등록' `
                -CanFix -FixId 'connect-harness'
        }
    } else {
        $checks += New-FbCheck -Id 'claude' -Label 'Claude Code' -Status 'warn' -Text '미설치'
    }

    $desktop = Get-FbClaudeDesktopConfigPath
    $desktopDir = Split-Path $desktop -Parent
    if (Test-Path -LiteralPath $desktopDir) {
        if (Test-FbJsonMcpEntry -Path $desktop -Name $script:FbMcpName) {
            $checks += New-FbCheck -Id 'claude-desktop' -Label 'Claude Desktop' -Status 'ok' -Text ([string]$desktop)
        } else {
            $checks += New-FbCheck -Id 'claude-desktop' -Label 'Claude Desktop' -Status 'fail' -Text 'TalkToFigma 미등록' `
                -CanFix -FixId 'connect-harness'
        }
    }

    $codex = Get-FbCodexPath
    if ($codex) {
        if (Test-FbCodexMcp) {
            $checks += New-FbCheck -Id 'codex' -Label 'Codex' -Status 'ok' -Text ([string]$codex)
        } else {
            $checks += New-FbCheck -Id 'codex' -Label 'Codex' -Status 'fail' -Text '앱은 있으나 TalkToFigma 미등록' `
                -CanFix -FixId 'connect-harness'
        }
    } else {
        $checks += New-FbCheck -Id 'codex' -Label 'Codex' -Status 'warn' -Text '미설치'
    }

    $hasHarness = $claude -or $codex -or (Test-Path -LiteralPath $desktopDir)
    if (-not $hasHarness) {
        $checks += New-FbCheck -Id 'harness-any' -Label 'AI 하네스' -Status 'fail' -Text 'Claude Code / Codex 가 없습니다' `
            -Hint '디자이너 PC 에 Claude Code 또는 Codex 를 먼저 설치하세요.'
    }

    return @($checks)
}

function Invoke-FbFix {
    param([string]$FixId)
    switch ($FixId) {
        'install-bun' { [void](Install-FbBun); return 'Bun 설치를 시도했습니다.' }
        'install-packages' { [void](Install-FbPackages); return '패키지를 설치했습니다.' }
        'start-socket' { [void](Start-FbSocket); return '중계 서버를 켰습니다.' }
        'restart-socket' { [void](Stop-FbSocket); [void](Start-FbSocket); return '중계 서버를 다시 켰습니다.' }
        'start-plugin' {
            $r = Start-FbPlugin
            return $r.Detail
        }
        'start-figma' {
            $p = Get-FbFigmaPath
            if ($p) { [void](Start-FbQuietProcess -FilePath $p); return '피그마를 실행했습니다.' }
            return '피그마 경로를 찾지 못했습니다.'
        }
        'connect-harness' {
            if (-not (Test-FbPackagesPresent)) { [void](Install-FbPackages) }
            [void](Connect-FbHarnesses)
            return '하네스 MCP 항목을 다시 썼습니다.'
        }
        default { return $null }
    }
}

function Invoke-FbDoctor {
    param([switch]$Fix)
    $applied = New-Object System.Collections.Generic.List[string]
    $before = @(Get-FbChecks)

    if ($Fix) {
        $fixIds = @()
        foreach ($c in $before) {
            if ($c.CanFix -and $c.Status -ne 'ok' -and $c.FixId -and ($fixIds -notcontains $c.FixId)) {
                $fixIds += $c.FixId
            }
        }
        foreach ($id in $fixIds) {
            try {
                $msg = Invoke-FbFix -FixId $id
                if ($msg) { $applied.Add($msg) }
            } catch {
                $applied.Add("고침 실패 ($id): $($_.Exception.Message)")
            }
        }
    }

    $after = @(Get-FbChecks)
    $fail = @($after | Where-Object { $_.Status -eq 'fail' })
    $warn = @($after | Where-Object { $_.Status -eq 'warn' })
    $leftover = @($fail + $warn)
    $aiEligible = ($fail.Count -gt 0)

    return [pscustomobject]@{
        Before     = $before
        After      = $after
        Applied    = @($applied)
        Failed     = $fail
        Warnings   = $warn
        Leftover   = $leftover
        AiEligible = $aiEligible
        Ok         = ($fail.Count -eq 0)
    }
}

function Protect-FbSecretText {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return $Text }
    $t = $Text
    $t = [regex]::Replace($t, '(?i)(bearer\s+)[A-Za-z0-9\-_\.=]+', '$1***')
    $t = [regex]::Replace($t, '(?i)("(?:Authorization|api[_-]?key|token|secret)"\s*:\s*")[^"]+"', '$1***"')
    $t = [regex]::Replace($t, '(?i)(sk-[A-Za-z0-9]{10,})', 'sk-***')
    return $t
}

function New-FbDoctorBundle {
    param($Doctor)
    $status = Get-FbOverallStatus
    $bundle = [pscustomobject]@{
        when         = (Get-Date).ToString('o')
        product      = $script:FbProductName
        mcpName      = $script:FbMcpName
        home         = (Get-FbHome)
        codeRoot     = (Get-FbCodeRoot)
        pluginUrl    = $script:FbPluginUrl
        channelHint  = $script:FbChannelHint
        appliedFixes = @($Doctor.Applied)
        checks       = @($Doctor.After)
        leftoverFail = @($Doctor.Failed | ForEach-Object { $_.Id })
        status       = [pscustomobject]@{
            bun          = [bool]$status.Bun
            packages     = $status.Packages
            socketHttp   = $status.Socket.HttpOk
            socketPid    = $status.Socket.Pid
            figmaRunning = $status.FigmaRunning
            relayOk      = $status.RelayOk
            pluginOn     = $status.PluginOn
            channels     = @($status.Channels)
            claudeMcp    = $status.ClaudeMcp
            desktopMcp   = $status.DesktopMcp
            codexMcp     = $status.CodexMcp
        }
    }
    return $bundle
}

function Get-FbAppPs1 {
    return (Join-Path (Get-FbCodeRoot) 'App.ps1')
}

function Invoke-FbAiDoctor {
    param($Doctor)
    Initialize-FbHome
    $bundle = New-FbDoctorBundle -Doctor $Doctor
    $jsonPath = Join-Path (Get-FbLogDir) ('doctor-bundle-{0}.json' -f (Get-FbTimestamp))
    Save-FbJsonFile -Path $jsonPath -Object $bundle

    $app = Get-FbAppPs1
    $promptPath = Join-Path (Get-FbCodeRoot) 'prompts\ai-doctor.md'
    $template = ''
    if (Test-Path -LiteralPath $promptPath) {
        $template = [IO.File]::ReadAllText($promptPath)
    } else {
        $template = 'Talk to Figma 연결을 고치세요. 결정론 CLI 만 사용하세요.'
    }
    $prompt = $template.Replace('{{BUNDLE}}', $jsonPath).
        Replace('{{APP}}', $app).
        Replace('{{HOME}}', (Get-FbHome)).
        Replace('{{CHANNEL}}', $script:FbChannelHint).
        Replace('{{PLUGIN}}', $script:FbPluginUrl)

    $promptFile = Join-Path (Get-FbLogDir) ('ai-doctor-prompt-{0}.md' -f (Get-FbTimestamp))
    $utf8 = New-Object System.Text.UTF8Encoding $true
    [IO.File]::WriteAllText($promptFile, $prompt, $utf8)

    $claude = Get-FbClaudePath
    $codex = Get-FbCodexPath
    if (-not $claude -and -not $codex) {
        throw '로컬 하네스(Claude Code 또는 Codex)가 없어 AI 점검을 맡길 수 없습니다.'
    }

    $outLog = Join-Path (Get-FbLogDir) ('ai-doctor-{0}.log' -f (Get-FbTimestamp))
    $errLog = Join-Path (Get-FbLogDir) ('ai-doctor-{0}.err.log' -f (Get-FbTimestamp))

    $file = $null
    $args = @()
    if ($claude) {
        $file = $claude
        $args = @(
            '-p', $prompt,
            '--output-format', 'text',
            '--allowedTools', 'Bash',
            '--add-dir', (Get-FbCodeRoot),
            '--add-dir', (Get-FbHome)
        )
    } else {
        $file = $codex
        if ($codex -match '\.ps1$') {
            $file = (Get-Command powershell.exe).Source
            $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $codex, 'exec', '--skip-git-repo-check', $prompt)
        } else {
            $args = @('exec', '--skip-git-repo-check', $prompt)
        }
    }

    $p = Start-FbQuietProcess -FilePath $file -ArgumentList $args -WorkingDirectory (Get-FbHome) `
        -StdOutPath $outLog -StdErrPath $errLog -Wait

    $outText = ''
    $errText = ''
    if (Test-Path -LiteralPath $outLog) { $outText = [IO.File]::ReadAllText($outLog) }
    if (Test-Path -LiteralPath $errLog) { $errText = [IO.File]::ReadAllText($errLog) }
    $combined = Protect-FbSecretText -Text ($outText + "`r`n" + $errText)

    $after = Invoke-FbDoctor
    return [pscustomobject]@{
        ExitCode = $p.ExitCode
        Output   = $combined
        LogPath  = $outLog
        Bundle   = $jsonPath
        After    = $after
        Harness  = $(if ($claude) { 'Claude Code' } else { 'Codex' })
    }
}
