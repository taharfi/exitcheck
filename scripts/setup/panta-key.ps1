param([switch]$Register)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
$workspacePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$envPath = Join-Path $workspacePath '.env.local'
$temporaryPath = Join-Path $workspacePath '.env.local.panta.tmp'
$backupPath = Join-Path $workspacePath '.env.local.panta.backup'
$handler = New-Object System.Net.Http.HttpClientHandler
$handler.AllowAutoRedirect = $false
$client = New-Object System.Net.Http.HttpClient($handler)
$client.Timeout = [TimeSpan]::FromSeconds(20)
$passwordPointer = [IntPtr]::Zero
$passwordText = $null
$login = $null
$created = $null

function Invoke-Panta([string]$Path, [hashtable]$Payload, [string]$Access) {
    $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, ('https://live-api.panta.market/api/v1' + $Path))
    $response = $null
    try {
        if ($Access) {
            $request.Headers.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $Access)
        }
        $json = ConvertTo-Json -InputObject $Payload -Compress
        $request.Content = New-Object System.Net.Http.StringContent($json, [System.Text.Encoding]::UTF8, 'application/json')
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode) {
            throw ('Panta returned HTTP ' + [int]$response.StatusCode + '. Check your account credentials. No response or credentials were printed.')
        }
        try {
            return ($response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json)
        } catch {
            throw 'Panta returned an unexpected response. No credentials were printed.'
        }
    } finally {
        if ($response) { $response.Dispose() }
        $request.Dispose()
    }
}

try {
    Write-Host 'Panta key setup. Credentials go directly to Panta over HTTPS.'
    Write-Host 'The script saves only the API key in the ignored .env.local file.'
    Write-Host 'Use an existing Panta account. For a new account, rerun with -Register.'
    $email = Read-Host 'Panta account email'
    $securePassword = Read-Host 'Panta password (hidden)' -AsSecureString
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $passwordText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $authPath = '/auth/token/'
    $payload = @{ email = $email; password = $passwordText }
    if ($Register) {
        $authPath = '/auth/register/'
        $payload.name = 'ExitCheck'
    }
    $login = Invoke-Panta $authPath $payload $null
    if (-not ($login.access -is [string]) -or -not $login.access) {
        throw 'Panta did not return an access token.'
    }
    $created = Invoke-Panta '/account/keys/' @{ env = 'test'; name = 'ExitCheck'; revokeOthers = $false } $login.access
    if (-not ($created.secret -is [string]) -or $created.secret -notmatch '^pk_test_[A-Za-z0-9._-]+$') {
        throw 'Panta did not return an expected API key. The response was not printed.'
    }
    if ((Test-Path -LiteralPath $envPath) -and ((Get-Item -LiteralPath $envPath).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
        throw 'Refusing to update a linked environment file.'
    }
    $existing = ''
    if (Test-Path -LiteralPath $envPath) { $existing = [System.IO.File]::ReadAllText($envPath) }
    $entry = 'PANTA_API_KEY=' + $created.secret
    if ([regex]::IsMatch($existing, '(?m)^PANTA_API_KEY=.*$')) {
        $updated = [regex]::Replace($existing, '(?m)^PANTA_API_KEY=.*$', $entry)
    } else {
        $updated = $existing.TrimEnd("`r", "`n") + "`r`n" + $entry + "`r`n"
    }
    if (Test-Path -LiteralPath $temporaryPath) { throw 'Temporary environment file already exists. No file was overwritten.' }
    [System.IO.File]::WriteAllText($temporaryPath, $updated, (New-Object System.Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $envPath) {
        if (Test-Path -LiteralPath $backupPath) { throw 'Environment backup already exists. No file was overwritten.' }
        [System.IO.File]::Replace($temporaryPath, $envPath, $backupPath)
        Remove-Item -LiteralPath $backupPath
    } else {
        [System.IO.File]::Move($temporaryPath, $envPath)
    }
    Write-Host 'Success: PANTA_API_KEY saved in .env.local. Existing keys were not revoked.'
    Write-Host 'Return to the chat and say saved. No key needs to be pasted.'
} catch {
    Write-Host ('Setup failed: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
    $passwordText = $null
    $payload = $null
    $login = $null
    $created = $null
    $updated = $null
    $entry = $null
    $client.Dispose()
    $handler.Dispose()
}
