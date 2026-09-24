function Compare-ToolkitEncryptionKeys {
    param([Parameter(Mandatory)][Security.SecureString]$ProductionKey,
          [Parameter(Mandatory)][Security.SecureString]$DevelopmentKey)
    $productionPointer = [IntPtr]::Zero
    $developmentPointer = [IntPtr]::Zero
    $productionBytes = $null
    $developmentBytes = $null
    try {
        $productionPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ProductionKey)
        $developmentPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($DevelopmentKey)
        $productionText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($productionPointer)
        $developmentText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($developmentPointer)
        if ($productionText -cnotmatch '^[A-Za-z0-9+/]{43}=$' -or $developmentText -cnotmatch '^[A-Za-z0-9+/]{43}=$') { throw 'INVALID' }
        $productionBytes = [Convert]::FromBase64String($productionText)
        $developmentBytes = [Convert]::FromBase64String($developmentText)
        if ($productionBytes.Length -ne 32 -or $developmentBytes.Length -ne 32 -or [Convert]::ToBase64String($productionBytes) -cne $productionText -or [Convert]::ToBase64String($developmentBytes) -cne $developmentText) { throw 'INVALID' }
        $difference = 0
        for ($index = 0; $index -lt 32; $index++) { $difference = $difference -bor ($productionBytes[$index] -bxor $developmentBytes[$index]) }
        if ($difference -eq 0) { 'SAME' } else { 'DIFFERENT' }
    } catch { throw 'KEY_COMPARISON_FAILED' }
    finally {
        if ($productionPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($productionPointer) }
        if ($developmentPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($developmentPointer) }
        if ($null -ne $productionBytes) { [Array]::Clear($productionBytes, 0, $productionBytes.Length) }
        if ($null -ne $developmentBytes) { [Array]::Clear($developmentBytes, 0, $developmentBytes.Length) }
        $productionText = $null
        $developmentText = $null
    }
}
Export-ModuleMember -Function Compare-ToolkitEncryptionKeys
