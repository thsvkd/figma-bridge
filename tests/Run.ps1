#Requires -Version 5.1
<#
================================================================================
 tests/Run.ps1
 목적: 이 레포의 회귀 검사를 돌린다. window-maintain 에 의존하지 않는다.
================================================================================
 [사용법]
   .\tests\Run.ps1
   .\tests\Run.ps1 --help
================================================================================
#>
[CmdletBinding()]
param(
    [Alias('h')]
    [switch]$Help,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$RemainingArgs
)

$ErrorActionPreference = 'Stop'

function Test-FbHelpToken {
    param([string]$Token)
    if ([string]::IsNullOrWhiteSpace($Token)) { return $false }
    $t = $Token.Trim().ToLowerInvariant()
    return ($t -eq '-h' -or $t -eq '--help' -or $t -eq '/?' -or $t -eq 'help')
}

if ($Help) {
    $raw = [IO.File]::ReadAllText($PSCommandPath)
    if ($raw -match '(?s)<#(.*?)#>') { Write-Host $Matches[1].Trim() }
    return
}
foreach ($a in @($RemainingArgs)) {
    if (Test-FbHelpToken $a) {
        $raw = [IO.File]::ReadAllText($PSCommandPath)
        if ($raw -match '(?s)<#(.*?)#>') { Write-Host $Matches[1].Trim() }
        return
    }
}

$script:Pass = 0
$script:Fail = 0
$script:Results = New-Object System.Collections.Generic.List[object]

function Add-WmResult {
    param(
        [Parameter(Mandatory = $true)][string]$Check,
        [Parameter(Mandatory = $true)][string]$Target,
        [Parameter(Mandatory = $true)][string]$Status,
        [string]$Detail
    )
    $script:Results.Add([pscustomobject]@{ Check = $Check; Target = $Target; Status = $Status; Detail = $Detail })
    if ($Status -eq 'FAIL') {
        $script:Fail++
        $msg = "$Check  $Target"
        if ($Detail) { $msg = "$msg  $Detail" }
        Write-Host "[FAIL] $msg"
    } else {
        $script:Pass++
        Write-Host "[PASS] $Check  $Target"
    }
}

$here = $PSScriptRoot
foreach ($file in @(Get-ChildItem -LiteralPath $here -Filter '*.ps1' -File | Where-Object { $_.Name -ne 'Run.ps1' } | Sort-Object Name)) {
    Write-Host ("---- {0} ----" -f $file.Name)
    . $file.FullName
}

Write-Host ("PASS={0} FAIL={1}" -f $script:Pass, $script:Fail)
if ($script:Fail -gt 0) { exit 1 }
exit 0
