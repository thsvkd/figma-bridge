#Requires -Version 5.1
# 피그마 플러그인을 대신 켜 준다.
# 피그마에는 밖에서 플러그인을 실행시키는 API 가 없다. 그래서 창을 앞으로 꺼낸 뒤
# 퀵 액션(Ctrl+/) 으로 플러그인 이름을 눌러 준다. 실패하면 마지막 플러그인 재실행으로 물러선다.

. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot 'Socket.ps1')

$script:FbUser32Source = @'
using System;
using System.Runtime.InteropServices;
public static class FbUser32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint attachTo, uint attachFrom, bool attach);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
'@

function Initialize-FbInterop {
    if (-not ('FbUser32' -as [type])) {
        Add-Type -TypeDefinition $script:FbUser32Source | Out-Null
    }
    Add-Type -AssemblyName System.Windows.Forms
}

function Get-FbFigmaWindowProcess {
    $procs = @(Get-Process -Name 'Figma' -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
            Sort-Object -Property WorkingSet64 -Descending)
    if ($procs.Count -eq 0) { return $null }
    return $procs[0]
}

function Show-FbFigmaWindow {
    Initialize-FbInterop
    $proc = Get-FbFigmaWindowProcess
    if (-not $proc) { return $false }
    $h = $proc.MainWindowHandle

    if ([FbUser32]::IsIconic($h)) { [void][FbUser32]::ShowWindow($h, 9) }
    [void][FbUser32]::SetForegroundWindow($h)
    Start-Sleep -Milliseconds 250

    # 포그라운드 전환이 막히면 입력 큐를 붙여서 한 번 더 시도한다.
    if ([FbUser32]::GetForegroundWindow() -ne $h) {
        [uint32]$targetPid = 0
        $targetThread = [FbUser32]::GetWindowThreadProcessId($h, [ref]$targetPid)
        $currentThread = [FbUser32]::GetCurrentThreadId()
        [void][FbUser32]::AttachThreadInput($currentThread, $targetThread, $true)
        [void][FbUser32]::SetForegroundWindow($h)
        [void][FbUser32]::AttachThreadInput($currentThread, $targetThread, $false)
        Start-Sleep -Milliseconds 250
    }
    return ([FbUser32]::GetForegroundWindow() -eq $h)
}

function ConvertTo-FbSendKeysText {
    param([string]$Text)
    $special = '+^%~(){}[]'
    $sb = New-Object System.Text.StringBuilder
    foreach ($ch in $Text.ToCharArray()) {
        if ($special.IndexOf($ch) -ge 0) {
            [void]$sb.Append('{').Append($ch).Append('}')
        } else {
            [void]$sb.Append($ch)
        }
    }
    return $sb.ToString()
}

function Send-FbKeys {
    param([string]$Keys, [int]$DelayMs = 150)
    [System.Windows.Forms.SendKeys]::SendWait($Keys)
    Start-Sleep -Milliseconds $DelayMs
}

function Wait-FbPluginConnected {
    param([int]$TimeoutSec = 12)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    do {
        $st = Get-FbSocketStatus
        if ($st.PluginConnected) { return $true }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    return $false
}

# 커뮤니티 플러그인 페이지를 브라우저가 아니라 피그마 앱 안에서 연다.
function Open-FbPluginPage {
    $figma = Get-FbFigmaPath
    if (-not $figma) { return $false }
    [void](Start-FbQuietProcess -FilePath $figma -ArgumentList @($script:FbPluginUrl))
    return $true
}

function Invoke-FbPluginQuickAction {
    if (-not (Show-FbFigmaWindow)) { return $false }
    Start-Sleep -Milliseconds 400
    Send-FbKeys -Keys '{ESC}' -DelayMs 200
    Send-FbKeys -Keys '^/' -DelayMs 600
    Send-FbKeys -Keys (ConvertTo-FbSendKeysText $script:FbPluginName) -DelayMs 900
    Send-FbKeys -Keys '{ENTER}' -DelayMs 300
    return $true
}

function Invoke-FbPluginRunLast {
    if (-not (Show-FbFigmaWindow)) { return $false }
    Start-Sleep -Milliseconds 300
    Send-FbKeys -Keys '{ESC}' -DelayMs 200
    Send-FbKeys -Keys '^%p' -DelayMs 300
    return $true
}

function Start-FbFigmaApp {
    $figma = Get-FbFigmaPath
    if (-not $figma) { return $false }
    if (-not (Test-FbFigmaRunning)) {
        [void](Start-FbQuietProcess -FilePath $figma)
    }
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        if (Get-FbFigmaWindowProcess) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return [bool](Get-FbFigmaWindowProcess)
}

# 연결 버튼이 부르는 진입점. 플러그인이 릴레이에 붙을 때까지 책임진다.
function Start-FbPlugin {
    param([int]$TimeoutSec = 12)

    $result = [pscustomobject]@{ Ok = $false; Method = 'none'; Detail = '' }

    $st = Get-FbSocketStatus
    if (-not $st.IsOurs) {
        $result.Detail = '중계 서버가 준비되지 않아 플러그인을 켤 수 없습니다.'
        return $result
    }
    if ($st.PluginConnected) {
        $result.Ok = $true
        $result.Method = 'already'
        $result.Detail = '피그마 플러그인이 이미 붙어 있습니다.'
        return $result
    }

    if (-not (Get-FbFigmaPath)) {
        $result.Detail = '피그마 데스크톱 앱이 없습니다. figma.com/downloads 에서 설치하세요.'
        return $result
    }

    Initialize-FbInterop
    $caller = [FbUser32]::GetForegroundWindow()

    try {
        if (-not (Start-FbFigmaApp)) {
            $result.Detail = '피그마 창을 찾지 못했습니다. 피그마에서 디자인 파일을 하나 열고 다시 [연결] 을 눌러 주세요.'
            return $result
        }

        $tried = @()
        if (Invoke-FbPluginQuickAction) {
            $tried += '퀵 액션'
            if (Wait-FbPluginConnected -TimeoutSec $TimeoutSec) {
                $result.Ok = $true
                $result.Method = 'quick-action'
                $result.Detail = '퀵 액션으로 플러그인을 실행했습니다.'
                return $result
            }
        }

        if (Invoke-FbPluginRunLast) {
            $tried += '마지막 플러그인 재실행'
            if (Wait-FbPluginConnected -TimeoutSec $TimeoutSec) {
                $result.Ok = $true
                $result.Method = 'run-last'
                $result.Detail = '마지막 플러그인 재실행으로 플러그인을 켰습니다.'
                return $result
            }
        }

        # 여기까지 왔으면 플러그인이 아직 설치되지 않았을 가능성이 크다. 설치 페이지를 앱 안에서 열어 준다.
        [void](Open-FbPluginPage)
        $result.Method = 'manual'
        $result.Detail = ('플러그인을 자동으로 켜지 못했습니다 (시도: ' + ($tried -join ', ') +
            '). 피그마에 열린 플러그인 페이지에서 Run 을 한 번 눌러 설치하고, 디자인 파일을 연 상태에서 [연결] 을 다시 누르세요.')
        return $result
    } finally {
        if ($caller -ne [IntPtr]::Zero) {
            [void][FbUser32]::SetForegroundWindow($caller)
        }
    }
}
