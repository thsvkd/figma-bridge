#Requires -Version 5.1
# 개발자 세팅이 없는 PC 를 가정한 하네스 설치 경로 검사.

$here = Split-Path $PSScriptRoot -Parent
. (Join-Path $here 'lib\HarnessInstall.ps1')

# 1. 카탈로그에는 winget 장치 ID 와 수동 설치 주소가 둘 다 있어야 한다.
#    (winget 이 없거나 막힌 PC 에서 안내할 곳이 필요하다.)
$catalog = @(Get-FbHarnessCatalog)
$missing = @($catalog | Where-Object { -not $_.WingetId -or -not $_.ManualUrl -or -not $_.Name })
if ($catalog.Count -lt 3) {
    Add-WmResult 'Harness' 'catalog' 'FAIL' "항목이 $($catalog.Count) 개뿐입니다"
} elseif ($missing.Count -gt 0) {
    Add-WmResult 'Harness' 'catalog' 'FAIL' ('빈 칸: ' + (($missing | ForEach-Object { $_.Id }) -join ', '))
} else {
    Add-WmResult 'Harness' 'catalog' 'PASS'
}

# 2. 권장 하네스는 정확히 하나여야 한다. 비개발자에게 고르라고 시키면 안 된다.
$recommended = @($catalog | Where-Object { $_.Recommended })
if ($recommended.Count -eq 1 -and $recommended[0].Id -eq 'claude') {
    Add-WmResult 'Harness' 'recommended' 'PASS'
} else {
    Add-WmResult 'Harness' 'recommended' 'FAIL' "권장이 $($recommended.Count) 개입니다"
}

# 3. 아무것도 안 깔린 PC 를 흉내 낸다. Test-FbAnyHarness 가 거짓이어야 한다.
$clean = & {
    function Get-FbClaudePath { return $null }
    function Get-FbCodexPath { return $null }
    function Get-FbClaudeDesktopDir { return $null }
    Test-FbAnyHarness
}
if ($clean) {
    Add-WmResult 'Harness' 'clean-pc' 'FAIL' '하네스가 없는데도 있다고 봅니다'
} else {
    Add-WmResult 'Harness' 'clean-pc' 'PASS'
}

# 4. 모르는 하네스는 거부해야 한다.
$rejected = $false
try { [void](Install-FbHarness -Id 'nope') } catch { $rejected = $true }
if ($rejected) {
    Add-WmResult 'Harness' 'reject-unknown' 'PASS'
} else {
    Add-WmResult 'Harness' 'reject-unknown' 'FAIL' '모르는 id 를 받아들였습니다'
}

# 5. 하네스가 없다고 연결을 통째로 실패시키면 안 된다. 거기서 비개발자가 막힌다.
$engineSrc = [IO.File]::ReadAllText((Join-Path $here 'lib\Engine.ps1'))
if ($engineSrc -match "throw '연결할 하네스") {
    Add-WmResult 'Harness' 'no-dead-end' 'FAIL' '하네스가 없으면 연결이 예외로 끝납니다'
} elseif ($engineSrc -notmatch 'HarnessMissing') {
    Add-WmResult 'Harness' 'no-dead-end' 'FAIL' '연결 결과가 하네스 없음을 알려주지 않습니다'
} else {
    Add-WmResult 'Harness' 'no-dead-end' 'PASS'
}

# 6. 점검이 하네스를 설치할 수 있어야 한다.
$doctorSrc = [IO.File]::ReadAllText((Join-Path $here 'lib\Doctor.ps1'))
if ($doctorSrc -match "'install-harness'\s*\{") {
    Add-WmResult 'Harness' 'doctor-fix' 'PASS'
} else {
    Add-WmResult 'Harness' 'doctor-fix' 'FAIL' 'Invoke-FbFix 에 install-harness 분기가 없습니다'
}

# 7. 설치 스크립트는 파일로 받아 -NoProfile -ExecutionPolicy Bypass 로 돌아야 한다.
#    셸에 바로 흘려 넣으면 프로필과 실행정책에 걸린다.
$installSrc = [IO.File]::ReadAllText((Join-Path $here 'lib\HarnessInstall.ps1'))
if ($installSrc -match '-NoProfile' -and $installSrc -match '-ExecutionPolicy' -and $installSrc -match '-OutFile') {
    Add-WmResult 'Harness' 'script-runner' 'PASS'
} else {
    Add-WmResult 'Harness' 'script-runner' 'FAIL' '설치 스크립트를 안전하게 돌리지 않습니다'
}
