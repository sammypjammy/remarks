# Run privately by the operator, never through a Codex terminal with real keys.
$ErrorActionPreference = 'Stop'
$productionKey = $null
$developmentKey = $null
try {
    Import-Module (Join-Path $PSScriptRoot 'PrivateKeyComparison.psm1') -Force
    $productionKey = Read-Host 'Production key (concealed input)' -AsSecureString
    $developmentKey = Read-Host 'Development key (concealed input)' -AsSecureString
    Compare-ToolkitEncryptionKeys -ProductionKey $productionKey -DevelopmentKey $developmentKey
} catch { [Console]::Error.WriteLine('KEY_COMPARISON_FAILED'); exit 1 }
finally {
    if ($null -ne $productionKey) { $productionKey.Dispose() }
    if ($null -ne $developmentKey) { $developmentKey.Dispose() }
}
