#Requires -Version 5.1
# 결정론 doctor 헬퍼: 비밀 가리기, 체크 객체, 플러그인은 CanFix 가 아님.

$here = Split-Path $PSScriptRoot -Parent
. (Join-Path $here 'lib\Common.ps1')
. (Join-Path $here 'lib\Doctor.ps1')

$redacted = Protect-FbSecretText -Text 'Authorization: Bearer abcdef.secret.token'
if ($redacted -match 'abcdef') {
    Add-WmResult 'DoctorSecret' 'bearer' 'FAIL' $redacted
} else {
    Add-WmResult 'DoctorSecret' 'bearer' 'PASS'
}

# 플러그인은 이제 점검이 대신 켠다. 체크는 고칠 수 있어야 한다.
$c = New-FbCheck -Id 'plugin' -Label '피그마 플러그인' -Status 'warn' -Text '아직 안 붙음' -Hint '대신 켭니다' -CanFix -FixId 'start-plugin'
if (-not $c.CanFix -or $c.FixId -ne 'start-plugin') {
    Add-WmResult 'DoctorCheck' 'plugin-fixable' 'FAIL' '플러그인 체크가 고칠 수 없는 상태입니다'
} elseif ($c.Id -ne 'plugin' -or $c.Status -ne 'warn') {
    Add-WmResult 'DoctorCheck' 'shape' 'FAIL' '체크 객체 모양이 틀립니다'
} else {
    Add-WmResult 'DoctorCheck' 'plugin-fixable' 'PASS'
}

# 그리고 doctor 에 그 고침 분기가 실제로 있어야 한다.
$doctorSrc = [IO.File]::ReadAllText((Join-Path $here 'lib\Doctor.ps1'))
if ($doctorSrc -match "'start-plugin'\s*\{") {
    Add-WmResult 'DoctorCheck' 'start-plugin-fix' 'PASS'
} else {
    Add-WmResult 'DoctorCheck' 'start-plugin-fix' 'FAIL' 'Invoke-FbFix 에 start-plugin 분기가 없습니다'
}

$prompt = Join-Path $here 'prompts\ai-doctor.md'
if (-not (Test-Path -LiteralPath $prompt)) {
    Add-WmResult 'AiPrompt' 'ai-doctor.md' 'FAIL' '프롬프트 파일 없음'
} else {
    $raw = [IO.File]::ReadAllText($prompt)
    $need = @('{{APP}}', '{{BUNDLE}}', '-Action doctor', '-Action connect', 'TalkToFigma')
    $missing = @($need | Where-Object { $raw -notlike "*$_*" })
    if ($missing.Count -gt 0) {
        Add-WmResult 'AiPrompt' 'placeholders' 'FAIL' ($missing -join ', ')
    } else {
        Add-WmResult 'AiPrompt' 'placeholders' 'PASS'
    }
}

$setup = Join-Path $here 'Setup.cmd'
$appCmd = Join-Path $here 'App.cmd'
if ((Test-Path -LiteralPath $setup) -and (Test-Path -LiteralPath $appCmd)) {
    Add-WmResult 'Launcher' 'cmd' 'PASS'
} else {
    Add-WmResult 'Launcher' 'cmd' 'FAIL' 'Setup.cmd / App.cmd 없음'
}
