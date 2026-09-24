param([Parameter(Mandatory)][string]$TargetFile, [switch]$Inspect)
# Read-only wrapper. No secret in process arguments, shell history, files or output.
$ErrorActionPreference = 'Stop'
$databaseSecret = $null
$neonSecret = $null
$databasePointer = [IntPtr]::Zero
$neonPointer = [IntPtr]::Zero
try {
    $targetPath = (Resolve-Path -LiteralPath $TargetFile).Path
    $databaseSecret = Read-Host 'Production DATABASE_URL (concealed input)' -AsSecureString
    $neonSecret = Read-Host 'Neon read-only API credential (concealed input)' -AsSecureString
    $databasePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($databaseSecret)
    $neonPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($neonSecret)
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
    $start.Arguments = '"' + $entry + '" ' + $mode + ' --production --target "' + $targetPath + '"'
    $start.EnvironmentVariables['DATABASE_URL'] = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($databasePointer)
    $start.EnvironmentVariables['NEON_API_KEY'] = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($neonPointer)
    $start.EnvironmentVariables['TOOLKIT_ORIGIN'] = 'https://packardtoolkit.vercel.app'
    $start.EnvironmentVariables['VERCEL_ENV'] = 'production'
    # Prevent inherited Node debugging/preload options from inspecting secrets.
    $start.EnvironmentVariables.Remove('NODE_OPTIONS')
    $start.EnvironmentVariables.Remove('NODE_DEBUG')
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    [void]$process.Start()
    $output = $process.StandardOutput.ReadToEnd()
    $null = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    [Console]::Write($output)
    $result = $process.ExitCode
    $start.EnvironmentVariables.Remove('DATABASE_URL')
    $start.EnvironmentVariables.Remove('NEON_API_KEY')
    $process.Dispose()
    exit $result
} catch { [Console]::Error.WriteLine('PREFLIGHT_WRAPPER_FAILED'); exit 1 }
finally {
    if ($databasePointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($databasePointer) }
    if ($neonPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($neonPointer) }
    if ($null -ne $databaseSecret) { $databaseSecret.Dispose() }
    if ($null -ne $neonSecret) { $neonSecret.Dispose() }
}
