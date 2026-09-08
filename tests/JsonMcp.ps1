#Requires -Version 5.1
# TalkToFigma JSON MCP 항목 추가/삭제가 다른 키를 건드리지 않는지.

$here = Split-Path $PSScriptRoot -Parent
. (Join-Path $here 'lib\Common.ps1')
. (Join-Path $here 'lib\Harness.ps1')

$tmp = Join-Path $env:TEMP ('fb-jsonmcp-' + [guid]::NewGuid().ToString('N') + '.json')
try {
    $seed = @{
        mcpServers = @{
            keepme = @{ url = 'http://example.invalid/mcp' }
        }
        other = 1
    }
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [IO.File]::WriteAllText($tmp, ($seed | ConvertTo-Json -Depth 8), $utf8)

    Set-FbJsonMcpEntry -Path $tmp -Name 'TalkToFigma' -Command 'C:\bun.exe' -Arguments @('C:\server.js')
    $after = Read-FbJsonFile -Path $tmp
    if ($after.other -ne 1) {
        Add-WmResult 'JsonMcp' 'preserve-other' 'FAIL' 'other 키가 사라졌습니다'
    } elseif ($null -eq $after.mcpServers.keepme) {
        Add-WmResult 'JsonMcp' 'preserve-keepme' 'FAIL' '기존 MCP 가 사라졌습니다'
    } elseif ($after.mcpServers.TalkToFigma.command -ne 'C:\bun.exe') {
        Add-WmResult 'JsonMcp' 'add' 'FAIL' 'TalkToFigma command 가 없습니다'
    } elseif (-not (Test-FbJsonMcpEntry -Path $tmp -Name 'TalkToFigma' -Command 'C:\bun.exe')) {
        Add-WmResult 'JsonMcp' 'test-entry' 'FAIL' 'Test-FbJsonMcpEntry 가 false'
    } else {
        Add-WmResult 'JsonMcp' 'add' 'PASS'
    }

    $removed = Remove-FbJsonMcpEntry -Path $tmp -Name 'TalkToFigma'
    $final = Read-FbJsonFile -Path $tmp
    if (-not $removed) {
        Add-WmResult 'JsonMcp' 'remove' 'FAIL' '제거가 false'
    } elseif ($null -ne $final.mcpServers.TalkToFigma) {
        Add-WmResult 'JsonMcp' 'remove' 'FAIL' 'TalkToFigma 가 남았습니다'
    } elseif ($null -eq $final.mcpServers.keepme) {
        Add-WmResult 'JsonMcp' 'remove-keep' 'FAIL' '기존 MCP 가 같이 지워졌습니다'
    } else {
        Add-WmResult 'JsonMcp' 'remove' 'PASS'
    }
} finally {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
}
