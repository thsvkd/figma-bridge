#Requires -Version 5.1
# Designer-facing WinForms UI. STA required.

. (Join-Path $PSScriptRoot 'Doctor.ps1')

function Add-FbStatusRow {
    param($Parent, [int]$Top, [string]$Name, [string]$Tag)
    $nameLbl = New-Object System.Windows.Forms.Label
    $nameLbl.Location = New-Object System.Drawing.Point(24, $Top)
    $nameLbl.Size = New-Object System.Drawing.Size(180, 22)
    $nameLbl.Text = $Name
    $nameLbl.Font = New-Object System.Drawing.Font('Segoe UI', 10)
    $Parent.Controls.Add($nameLbl)

    $val = New-Object System.Windows.Forms.Label
    $val.Location = New-Object System.Drawing.Point(210, $Top)
    $val.Size = New-Object System.Drawing.Size(530, 22)
    $val.Font = New-Object System.Drawing.Font('Segoe UI', 10)
    $val.Tag = $Tag
    $Parent.Controls.Add($val)
    return $val
}

function Set-FbStatusLabel {
    param($Label, [string]$Kind, [string]$Text)
    $Label.Text = $Text
    switch ($Kind) {
        'ok' { $Label.ForeColor = [System.Drawing.Color]::FromArgb(20, 120, 60) }
        'fail' { $Label.ForeColor = [System.Drawing.Color]::FromArgb(180, 30, 30) }
        'warn' { $Label.ForeColor = [System.Drawing.Color]::FromArgb(150, 100, 0) }
        default { $Label.ForeColor = [System.Drawing.Color]::FromArgb(70, 70, 70) }
    }
}

function Write-FbGuiLog {
    param($Box, [string]$Text)
    if (-not $Box) { return }
    $stamp = (Get-Date).ToString('HH:mm:ss')
    $Box.AppendText("[$stamp] $Text`r`n")
    $Box.SelectionStart = $Box.Text.Length
    $Box.ScrollToCaret()
}

function Update-FbGuiStatus {
    param($Ui)
    $st = Get-FbOverallStatus
    if ($st.Bun) { Set-FbStatusLabel $Ui.Bun 'ok' $st.Bun } else { Set-FbStatusLabel $Ui.Bun 'fail' '없음 — 연결 시 설치합니다' }
    if ($st.Packages) { Set-FbStatusLabel $Ui.Pkg 'ok' '고정 버전 준비됨' } else { Set-FbStatusLabel $Ui.Pkg 'warn' '아직 받지 않음' }

    if ($st.Socket.HttpOk -and $st.Socket.IsOurs) {
        Set-FbStatusLabel $Ui.Sock 'ok' '127.0.0.1:3055 실행 중'
    } elseif ($st.Socket.HttpOk) {
        Set-FbStatusLabel $Ui.Sock 'warn' '다른 중계 서버가 3055 를 쓰는 중 — [연결] 이 바꿔 답니다'
    } elseif ($st.Socket.Running) {
        Set-FbStatusLabel $Ui.Sock 'warn' '프로세스는 있으나 응답 없음'
    } else {
        Set-FbStatusLabel $Ui.Sock 'fail' '꺼짐'
    }

    if ($st.PluginOn) {
        Set-FbStatusLabel $Ui.Plugin 'ok' '연결됨 — AI에게 바로 시키면 됩니다'
    } elseif ($st.Socket.IsOurs) {
        Set-FbStatusLabel $Ui.Plugin 'warn' '아직 안 붙음 — [연결] 이 대신 켭니다'
    } else {
        Set-FbStatusLabel $Ui.Plugin 'fail' '중계 서버부터 켜야 합니다'
    }

    if ($st.FigmaPath -and $st.FigmaRunning) {
        Set-FbStatusLabel $Ui.Figma 'ok' '실행 중'
    } elseif ($st.FigmaPath) {
        Set-FbStatusLabel $Ui.Figma 'warn' '설치됨 · 꺼져 있음'
    } else {
        Set-FbStatusLabel $Ui.Figma 'fail' '미설치'
    }

    if ($st.ClaudePath -and $st.ClaudeMcp) {
        Set-FbStatusLabel $Ui.Claude 'ok' 'TalkToFigma 연결됨'
    } elseif ($st.ClaudePath) {
        Set-FbStatusLabel $Ui.Claude 'warn' '설치됨 · 아직 연결 안 됨'
    } else {
        Set-FbStatusLabel $Ui.Claude 'fail' '미설치'
    }

    if ($st.CodexPath -and $st.CodexMcp) {
        Set-FbStatusLabel $Ui.Codex 'ok' 'TalkToFigma 연결됨'
    } elseif ($st.CodexPath) {
        Set-FbStatusLabel $Ui.Codex 'warn' '설치됨 · 아직 연결 안 됨'
    } else {
        Set-FbStatusLabel $Ui.Codex 'fail' '미설치'
    }

    if ($st.DesktopMcp) {
        Set-FbStatusLabel $Ui.Desktop 'ok' 'TalkToFigma 연결됨'
    } elseif (Test-Path -LiteralPath (Split-Path (Get-FbClaudeDesktopConfigPath) -Parent)) {
        Set-FbStatusLabel $Ui.Desktop 'warn' '앱 있음 · 아직 연결 안 됨'
    } else {
        Set-FbStatusLabel $Ui.Desktop 'warn' '없음'
    }

    $Ui.AiButton.Enabled = $false
    return $st
}

function Show-FbGui {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()
    try { [void][System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault($false) } catch { }

    $form = New-Object System.Windows.Forms.Form
    $form.Text = $script:FbProductName
    $form.Size = New-Object System.Drawing.Size(780, 730)
    $form.StartPosition = 'CenterScreen'
    $form.MinimumSize = New-Object System.Drawing.Size(720, 670)
    $form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
    $form.BackColor = [System.Drawing.Color]::FromArgb(250, 250, 248)

    $title = New-Object System.Windows.Forms.Label
    $title.Location = New-Object System.Drawing.Point(24, 18)
    $title.Size = New-Object System.Drawing.Size(500, 32)
    $title.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 16)
    $title.Text = $script:FbProductName
    $form.Controls.Add($title)

    $sub = New-Object System.Windows.Forms.Label
    $sub.Location = New-Object System.Drawing.Point(24, 52)
    $sub.Size = New-Object System.Drawing.Size(700, 40)
    $sub.ForeColor = [System.Drawing.Color]::FromArgb(80, 80, 80)
    $sub.Text = 'Talk to Figma MCP 로 이 PC의 Claude Code / Codex 와 피그마 앱을 연결합니다. 완전 로컬 · 무료.'
    $form.Controls.Add($sub)

    $y = 100
    $bunLbl = Add-FbStatusRow -Parent $form -Top $y -Name 'Bun 런타임' -Tag 'bun'; $y += 26
    $pkgLbl = Add-FbStatusRow -Parent $form -Top $y -Name 'Talk to Figma' -Tag 'pkg'; $y += 26
    $sockLbl = Add-FbStatusRow -Parent $form -Top $y -Name '중계 서버' -Tag 'sock'; $y += 26
    $figLbl = Add-FbStatusRow -Parent $form -Top $y -Name '피그마 앱' -Tag 'figma'; $y += 26
    $plugLbl = Add-FbStatusRow -Parent $form -Top $y -Name '피그마 플러그인' -Tag 'plugin'; $y += 26
    $clLbl = Add-FbStatusRow -Parent $form -Top $y -Name 'Claude Code' -Tag 'claude'; $y += 26
    $cdLbl = Add-FbStatusRow -Parent $form -Top $y -Name 'Claude Desktop' -Tag 'desktop'; $y += 26
    $cxLbl = Add-FbStatusRow -Parent $form -Top $y -Name 'Codex' -Tag 'codex'; $y += 36

    $btnConnect = New-Object System.Windows.Forms.Button
    $btnConnect.Text = '연결'
    $btnConnect.Location = New-Object System.Drawing.Point(24, $y)
    $btnConnect.Size = New-Object System.Drawing.Size(120, 36)
    $form.Controls.Add($btnConnect)

    $btnDisc = New-Object System.Windows.Forms.Button
    $btnDisc.Text = '연결 해제'
    $btnDisc.Location = New-Object System.Drawing.Point(154, $y)
    $btnDisc.Size = New-Object System.Drawing.Size(120, 36)
    $form.Controls.Add($btnDisc)

    $btnDoc = New-Object System.Windows.Forms.Button
    $btnDoc.Text = '점검'
    $btnDoc.Location = New-Object System.Drawing.Point(284, $y)
    $btnDoc.Size = New-Object System.Drawing.Size(120, 36)
    $form.Controls.Add($btnDoc)

    $btnRef = New-Object System.Windows.Forms.Button
    $btnRef.Text = '새로고침'
    $btnRef.Location = New-Object System.Drawing.Point(414, $y)
    $btnRef.Size = New-Object System.Drawing.Size(120, 36)
    $form.Controls.Add($btnRef)
    $y += 48

    $btnPlug = New-Object System.Windows.Forms.Button
    $btnPlug.Text = '플러그인 설치 페이지'
    $btnPlug.Location = New-Object System.Drawing.Point(24, $y)
    $btnPlug.Size = New-Object System.Drawing.Size(180, 32)
    $form.Controls.Add($btnPlug)

    $btnFigma = New-Object System.Windows.Forms.Button
    $btnFigma.Text = '피그마 실행'
    $btnFigma.Location = New-Object System.Drawing.Point(214, $y)
    $btnFigma.Size = New-Object System.Drawing.Size(120, 32)
    $form.Controls.Add($btnFigma)

    $btnAi = New-Object System.Windows.Forms.Button
    $btnAi.Text = 'AI에게 점검 맡기기'
    $btnAi.Location = New-Object System.Drawing.Point(344, $y)
    $btnAi.Size = New-Object System.Drawing.Size(190, 32)
    $btnAi.Enabled = $false
    $form.Controls.Add($btnAi)
    $y += 44

    $hint = New-Object System.Windows.Forms.Label
    $hint.Location = New-Object System.Drawing.Point(24, $y)
    $hint.Size = New-Object System.Drawing.Size(720, 40)
    $hint.ForeColor = [System.Drawing.Color]::FromArgb(70, 70, 70)
    $hint.Text = '연결을 누르면 중계 서버 · AI 설정 · 피그마 플러그인까지 한 번에 준비합니다. 채널 이름은 맞출 필요가 없습니다.'
    $form.Controls.Add($hint)
    $y += 44

    $log = New-Object System.Windows.Forms.TextBox
    $log.Multiline = $true
    $log.ScrollBars = 'Vertical'
    $log.ReadOnly = $true
    $log.Location = New-Object System.Drawing.Point(24, $y)
    $log.Size = New-Object System.Drawing.Size(716, 280)
    $log.Anchor = 'Top,Bottom,Left,Right'
    $log.Font = New-Object System.Drawing.Font('Consolas', 9)
    $log.BackColor = [System.Drawing.Color]::White
    $form.Controls.Add($log)

    $script:FbGui = @{
        Form       = $form
        Bun        = $bunLbl
        Pkg        = $pkgLbl
        Sock       = $sockLbl
        Figma      = $figLbl
        Plugin     = $plugLbl
        Claude     = $clLbl
        Desktop    = $cdLbl
        Codex      = $cxLbl
        Log        = $log
        AiButton   = $btnAi
        BtnConnect = $btnConnect
        BtnDisc    = $btnDisc
        BtnDoc     = $btnDoc
        BtnRef     = $btnRef
        LastDoc    = $null
    }

    function Set-FbGuiBusy {
        param([bool]$On)
        $g = $script:FbGui
        $g.BtnConnect.Enabled = -not $On
        $g.BtnDisc.Enabled = -not $On
        $g.BtnDoc.Enabled = -not $On
        $g.BtnRef.Enabled = -not $On
        $g.Form.Cursor = $(if ($On) { [System.Windows.Forms.Cursors]::WaitCursor } else { [System.Windows.Forms.Cursors]::Default })
        [System.Windows.Forms.Application]::DoEvents()
    }

    $btnRef.Add_Click({
            $g = $script:FbGui
            try {
                [void](Update-FbGuiStatus -Ui $g)
                Write-FbGuiLog $g.Log '상태를 새로고침했습니다.'
            } catch {
                Write-FbGuiLog $g.Log ("오류: " + $_.Exception.Message)
            }
        })

    $btnConnect.Add_Click({
            $g = $script:FbGui
            Set-FbGuiBusy $true
            try {
                Write-FbGuiLog $g.Log '연결을 시작합니다…'
                $r = Invoke-FbConnect
                foreach ($n in @($r.Notes)) { Write-FbGuiLog $g.Log $n }
                foreach ($h in @($r.Harness)) {
                    $mark = $(if ($h.Ok) { 'OK' } else { '실패' })
                    Write-FbGuiLog $g.Log ("{0}: {1} — {2}" -f $mark, $h.Target, $h.Detail)
                }
                if ($r.Plugin) {
                    $mark = $(if ($r.Plugin.Ok) { 'OK' } else { '!!' })
                    Write-FbGuiLog $g.Log ("{0}: 피그마 플러그인 — {1}" -f $mark, $r.Plugin.Detail)
                }
                if ($r.Plugin -and $r.Plugin.Ok) {
                    Write-FbGuiLog $g.Log '준비 끝. AI에게 "피그마 보여?" 라고 물어보세요.'
                }
                [void](Update-FbGuiStatus -Ui $g)
            } catch {
                Write-FbGuiLog $g.Log ("연결 실패: " + $_.Exception.Message)
            } finally { Set-FbGuiBusy $false }
        })

    $btnDisc.Add_Click({
            $g = $script:FbGui
            Set-FbGuiBusy $true
            try {
                Write-FbGuiLog $g.Log '연결을 해제합니다…'
                [void](Invoke-FbDisconnect)
                Write-FbGuiLog $g.Log '하네스 설정에서 TalkToFigma 를 빼고 중계 서버를 멈췄습니다.'
                [void](Update-FbGuiStatus -Ui $g)
            } catch {
                Write-FbGuiLog $g.Log ("해제 실패: " + $_.Exception.Message)
            } finally { Set-FbGuiBusy $false }
        })

    $btnDoc.Add_Click({
            $g = $script:FbGui
            Set-FbGuiBusy $true
            try {
                Write-FbGuiLog $g.Log '결정론 점검을 실행합니다…'
                $doc = Invoke-FbDoctor -Fix
                $script:FbGui.LastDoc = $doc
                foreach ($a in @($doc.Applied)) { Write-FbGuiLog $g.Log ("고침: " + $a) }
                foreach ($c in @($doc.After)) {
                    $mark = $c.Status.ToUpper()
                    $line = "{0}  {1}: {2}" -f $mark, $c.Label, $c.Text
                    if ($c.Hint) { $line = "$line  — $($c.Hint)" }
                    Write-FbGuiLog $g.Log $line
                }
                if ($doc.Ok) {
                    Write-FbGuiLog $g.Log '결정론 점검: 실패한 항목이 없습니다. 플러그인 Join 만 확인하세요.'
                } else {
                    Write-FbGuiLog $g.Log '결정론으로 못 고친 항목이 있습니다. AI에게 점검을 맡길 수 있습니다.'
                }
                [void](Update-FbGuiStatus -Ui $g)
                $g.AiButton.Enabled = [bool]$doc.AiEligible
            } catch {
                Write-FbGuiLog $g.Log ("점검 실패: " + $_.Exception.Message)
            } finally { Set-FbGuiBusy $false }
        })

    $btnAi.Add_Click({
            $g = $script:FbGui
            Set-FbGuiBusy $true
            try {
                $doc = $g.LastDoc
                if ($null -eq $doc) { $doc = Invoke-FbDoctor -Fix }
                Write-FbGuiLog $g.Log '로컬 하네스에 점검을 맡깁니다. 몇 분 걸릴 수 있습니다…'
                $ai = Invoke-FbAiDoctor -Doctor $doc
                Write-FbGuiLog $g.Log ("하네스: {0}  (exit {1})" -f $ai.Harness, $ai.ExitCode)
                if ($ai.Output) {
                    $clip = $ai.Output
                    if ($clip.Length -gt 4000) { $clip = $clip.Substring(0, 4000) + "`r`n…(로그 파일에 나머지)" }
                    Write-FbGuiLog $g.Log $clip
                }
                Write-FbGuiLog $g.Log ("로그: " + $ai.LogPath)
                $script:FbGui.LastDoc = $ai.After
                [void](Update-FbGuiStatus -Ui $g)
                $g.AiButton.Enabled = [bool]$ai.After.AiEligible
            } catch {
                Write-FbGuiLog $g.Log ("AI 점검 실패: " + $_.Exception.Message)
            } finally { Set-FbGuiBusy $false }
        })

    $btnPlug.Add_Click({
            $g = $script:FbGui
            if (Open-FbPluginPage) {
                Write-FbGuiLog $g.Log '피그마 앱에서 플러그인 설치 페이지를 열었습니다. Run 을 한 번 누르면 설치됩니다.'
            } else {
                Start-Process $script:FbPluginUrl
            }
        })
    $btnFigma.Add_Click({
            $p = Get-FbFigmaPath
            if ($p) { [void](Start-FbQuietProcess -FilePath $p) } else { Start-Process 'https://www.figma.com/downloads/' }
        })

    $form.Add_Shown({
            $g = $script:FbGui
            try {
                [void](Update-FbGuiStatus -Ui $g)
                Write-FbGuiLog $g.Log '준비됐습니다. 연결을 누르면 Talk to Figma 를 붙입니다.'
            } catch {
                Write-FbGuiLog $g.Log ("시작 오류: " + $_.Exception.Message)
            }
        })

    [void]$form.ShowDialog()
}
