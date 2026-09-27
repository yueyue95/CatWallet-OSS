$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")

$builderImage = "catwallet-builder"

if ($null -eq (Get-Command docker.exe -ErrorAction SilentlyContinue)) {
  throw "Docker is required to run the CatWallet acceptance container."
}

$composeFile = Join-Path (Get-Location) "docker-compose.acceptance.yml"
if (-not (Test-Path -LiteralPath $composeFile)) {
  throw "The CatWallet Docker acceptance compose file was not found."
}

& cmd.exe /d /c docker compose --env-file .env.local -f $composeFile build $builderImage
if ($LASTEXITCODE -ne 0) {
  throw "The CatWallet Docker acceptance image could not be built."
}

$secureToken = Read-Host "Paste the short-lived Supabase access token" -AsSecureString
$tokenPointer = [IntPtr]::Zero
$exitCode = 0

try {
  $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  $env:CATWALLET_MCP_ACCESS_TOKEN =
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)

  $dockerArguments = @(
    "run",
    "--rm",
    "--network",
    "host",
    "--env",
    "CATWALLET_MCP_ACCESS_TOKEN",
    "--entrypoint",
    "pnpm",
    $builderImage,
    "mcp:acceptance:write"
  )

  & cmd.exe /d /c docker @dockerArguments
  $exitCode = $LASTEXITCODE
}
finally {
  Remove-Item Env:CATWALLET_MCP_ACCESS_TOKEN -ErrorAction SilentlyContinue

  if ($tokenPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
  }

  if ($null -ne $secureToken) {
    $secureToken.Dispose()
  }
}

if ($exitCode -ne 0) {
  exit $exitCode
}
