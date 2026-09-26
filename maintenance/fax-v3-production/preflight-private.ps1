param([Parameter(Mandatory)][string]$TargetFile, [switch]$Inspect, [switch]$IdentityOnly)
# Read-only wrapper. No secret in process arguments, shell history, files or output.
$ErrorActionPreference = 'Stop'
$databaseSecret = $null
$databasePointer = [IntPtr]::Zero
$databaseValue = $null
$transportBytes = $null
$wrapperFailure = 'PREFLIGHT_WRAPPER_FAILED'
try {
    if ($Inspect -and $IdentityOnly) { throw 'MODE_INVALID' }
    $targetPath = (Resolve-Path -LiteralPath $TargetFile).Path
    $wrapperFailure = 'SECURE_INPUT_CAPTURE_FAILED'
    $databaseSecret = Read-Host 'Production DATABASE_URL (concealed input; use the terminal Paste action)' -AsSecureString
    $databasePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($databaseSecret)
    $wrapperFailure = 'SECURE_INPUT_CONVERSION_FAILED'
    $databaseValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($databasePointer)
    if ($databaseValue.Length -ne $databaseSecret.Length) { throw 'CONVERSION_FAILED' }
    for ($inputIndex = 0; $inputIndex -lt $databaseSecret.Length; $inputIndex++) {
        $nativeUnit = [Runtime.InteropServices.Marshal]::ReadInt16($databasePointer, 2 * $inputIndex) -band 65535
        if ($nativeUnit -ne [int][char]$databaseValue[$inputIndex]) { throw 'CONVERSION_FAILED' }
    }
    # Some console hosts deliver a paste shortcut as a control key to Read-Host.
    # Reject that capture; do not read clipboard, strip controls or synthesize a URI.
    $wrapperFailure = 'SECURE_INPUT_CONTROL_ONLY_CAPTURE_REJECTED_USE_TERMINAL_PASTE'
    if ($databaseValue -cmatch '\A[\x00-\x1f\x7f]+\z') { throw 'CONTROL_ONLY_CAPTURE' }
    $wrapperFailure = 'SECURE_INPUT_ENVIRONMENT_UNREPRESENTABLE'
    if ($databaseValue.IndexOf([char]0) -ge 0) { throw 'NUL_INPUT' }
    $wrapperFailure = 'PREFLIGHT_WRAPPER_FAILED'
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = (Get-Command node.exe -ErrorAction Stop).Source
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    # Only nonsecret, locally resolved paths enter the command line. Quotes/newlines rejected.
    $entry = Join-Path $PSScriptRoot 'preflight.mjs'
    if ($targetPath -match '["\r\n]' -or $entry -match '["\r\n]') { throw 'PATH_INVALID' }
    $mode = '--read-only'
    if ($Inspect) { $mode = '--inspect' }
    if ($IdentityOnly) { $entry = Join-Path $PSScriptRoot 'identity-diagnostic.mjs' }
    $start.Arguments = '"' + $entry + '" ' + $mode + ' --production --target "' + $targetPath + '"'
    if ($IdentityOnly) { $start.Arguments = '"' + $entry + '" --target "' + $targetPath + '"' }
    $start.EnvironmentVariables['DATABASE_URL'] = $databaseValue
    if ($IdentityOnly) {
        $start.RedirectStandardInput = $true
        $start.Arguments += ' --verify-transport'
    }
    $start.EnvironmentVariables.Remove('NEON_API_KEY')
    $start.EnvironmentVariables['TOOLKIT_ORIGIN'] = 'https://packardtoolkit.vercel.app'
    $start.EnvironmentVariables['VERCEL_ENV'] = 'production'
    # Prevent inherited Node debugging/preload options from inspecting secrets.
    $start.EnvironmentVariables.Remove('NODE_OPTIONS')
    $start.EnvironmentVariables.Remove('NODE_DEBUG')
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    [void]$process.Start()
    if ($IdentityOnly) {
        # Independent pipe copy proves the child environment received the captured
        # string exactly. Raw UTF-16 avoids shell/JSON/console encoding conversions.
        $wrapperFailure = 'SECURE_INPUT_TRANSPORT_FAILED'
        $transportBytes = [Text.Encoding]::Unicode.GetBytes($databaseValue)
        $process.StandardInput.BaseStream.Write($transportBytes, 0, $transportBytes.Length)
        $process.StandardInput.BaseStream.Flush()
        $process.StandardInput.Close()
        [Array]::Clear($transportBytes, 0, $transportBytes.Length)
        $wrapperFailure = 'PREFLIGHT_WRAPPER_FAILED'
    }
    $output = $process.StandardOutput.ReadToEnd()
    $null = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    [Console]::Write($output)
    $result = $process.ExitCode
    $start.EnvironmentVariables.Remove('DATABASE_URL')
    $start.EnvironmentVariables.Remove('NEON_API_KEY')
    $process.Dispose()
    exit $result
} catch { [Console]::Error.WriteLine($wrapperFailure); exit 1 }
finally {
    if ($null -ne $transportBytes) { [Array]::Clear($transportBytes, 0, $transportBytes.Length) }
    $databaseValue = $null
    if ($databasePointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($databasePointer) }
    if ($null -ne $databaseSecret) { $databaseSecret.Dispose() }
}
