$ErrorActionPreference = 'Stop'
if (-not $env:WINDOWS_CERTIFICATE -or -not $env:WINDOWS_CERTIFICATE_PASSWORD) {
    throw 'Release requires WINDOWS_CERTIFICATE and WINDOWS_CERTIFICATE_PASSWORD secrets.'
}
$certificateFile = Join-Path $env:RUNNER_TEMP 'rawh-signing.pfx'
try {
    [IO.File]::WriteAllBytes($certificateFile, [Convert]::FromBase64String($env:WINDOWS_CERTIFICATE))
    $certificatePassword = ConvertTo-SecureString -String $env:WINDOWS_CERTIFICATE_PASSWORD -AsPlainText -Force
    $certificate = Import-PfxCertificate -FilePath $certificateFile -CertStoreLocation Cert:\CurrentUser\My -Password $certificatePassword
    if (-not $certificate.HasPrivateKey -or $certificate.NotAfter -le (Get-Date)) {
        throw 'The publisher certificate must have a private key and must not be expired.'
    }
    "WINDOWS_CERTIFICATE_THUMBPRINT=$($certificate.Thumbprint)" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
} finally {
    if (Test-Path -LiteralPath $certificateFile) { Remove-Item -LiteralPath $certificateFile }
}
