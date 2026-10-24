<#
.SYNOPSIS
  Deploys pigeon-post (API + site) to AWS.

.DESCRIPTION
  .\deploy.ps1            CI deploy (default). Runs the checks, pushes the current commit to origin/main
                          (fast-forward only, never forced) and watches the GitHub Actions run, which tests
                          and then deploys the stack and the site. Uncommitted changes are NOT deployed.

  .\deploy.ps1 -Local     Deploys straight from this machine with SAM and the AWS CLI, the same steps as
                          .github/workflows/deploy.yml. It builds the CURRENT WORKING TREE, so uncommitted
                          changes ARE deployed. Needs the AWS CLI, SAM CLI and an AWS profile (default: pigeon).

  Options
    -Profile <name>               AWS profile for -Local (default: pigeon)
    -PermissionsBoundaryArn <arn> for -Local; defaults to $env:AWS_PERMISSIONS_BOUNDARY_ARN. Omitted = keep the
                                  value already on the stack.
    -SkipChecks                   skip tsc + tests (not recommended)
    -Yes                          do not ask for confirmation

  Optional environment variables for -Local (same names as the GitHub repo variables): GOOGLE_CLIENT_ID
  (falls back to the GOOGLE_CLIENT_ID line in .env), SES_SENDER_EMAIL, BEDROCK_MODEL_ID, DOMAIN, HOSTED_ZONE_ID.
  The Google client secret is read from SSM /pigeon/google-client-secret.

  Run from PowerShell:  powershell -ExecutionPolicy Bypass -File .\deploy.ps1   (or: npm run deploy)
#>
param(
  [switch]$Local,
  [string]$Profile = 'pigeon',
  [string]$PermissionsBoundaryArn = $env:AWS_PERMISSIONS_BOUNDARY_ARN,
  [switch]$SkipChecks,
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "`nSTOPPED: $msg" -ForegroundColor Red; exit 1 }
# Runs a native command and stops the script when it fails.
function Run {
  param([string]$Exe, [string[]]$Arguments)
  & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) { Fail "'$Exe $($Arguments -join ' ')' failed (exit $LASTEXITCODE)" }
}
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Confirm-Go($question) {
  if ($Yes) { return }
  if ((Read-Host "$question [y/N]") -notmatch '^(y|yes)$') { Fail 'cancelled' }
}

Step 'What will be deployed'
foreach ($tool in @('git', 'node', 'npm')) { if (-not (Have $tool)) { Fail "$tool is not installed or not on PATH" } }
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
$head = (git log -1 --format='%h %s').Trim()
$dirty = @(git status --porcelain | Where-Object { $_ -notmatch '^\?\? \.claude/' })
Write-Host "Branch : $branch"
Write-Host "Commit : $head"
if ($dirty.Count -gt 0) {
  Write-Host "Uncommitted changes ($($dirty.Count)):" -ForegroundColor Yellow
  $dirty | Select-Object -First 12 | ForEach-Object { Write-Host "  $_" }
  if ($Local) { Write-Host 'These ARE included in a -Local deploy.' -ForegroundColor Yellow }
  else { Write-Host 'These are NOT part of the commit, so they will NOT be deployed. Commit them first if you want them live.' -ForegroundColor Yellow }
}

if (-not $SkipChecks) {
  Step 'Checks: type-check, site tests, API tests'
  if (-not (Test-Path node_modules)) { Run 'npm' @('ci') }
  if (-not (Test-Path api\node_modules)) { Run 'npm' @('--prefix', 'api', 'ci') }
  Run 'npx' @('--no-install', 'tsc', '-b')
  Run 'npm' @('test')
  Run 'npm' @('--prefix', 'api', 'test')
}

if (-not $Local) {
  # ---- CI deploy: push to main, GitHub Actions does the rest -------------------------------------------------
  Step 'Checking origin/main'
  # A plain push can hang on the Windows credential manager; GitHub CLI's login is used when available.
  $gitAuth = @()
  if ((Have 'gh') -and ((gh auth status 2>&1 | Out-String) -match 'Logged in')) {
    $gitAuth = @('-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential')
  }
  $env:GIT_TERMINAL_PROMPT = '0'
  Run 'git' ($gitAuth + @('fetch', 'origin'))
  git merge-base --is-ancestor origin/main HEAD
  if ($LASTEXITCODE -ne 0) {
    Fail ("origin/main has commits that your current commit does not contain, so this push would not be a fast-forward.`n" +
      "  Merge first (git merge origin/main), re-run, or deploy with -Local. This script never force-pushes.")
  }
  $ahead = (git rev-list --count origin/main..HEAD).Trim()
  if ($ahead -eq '0') { Write-Host 'origin/main already has this commit; nothing to push (re-run the last workflow with: gh run rerun).' -ForegroundColor Yellow }
  Confirm-Go "Push $ahead commit(s) to origin/main and trigger the AWS deploy?"
  if ($ahead -ne '0') { Run 'git' ($gitAuth + @('push', 'origin', 'HEAD:main')) }

  if (Have 'gh') {
    Step 'Watching the GitHub Actions run (Ctrl+C stops watching, not the deploy)'
    Start-Sleep -Seconds 8
    $id = (gh run list --branch main --limit 1 --json databaseId --jq '.[0].databaseId').Trim()
    Run 'gh' @('run', 'watch', $id, '--exit-status')
    Write-Host "`nDeployed. Hard-refresh the site (and on phones, reload twice) to get the new build." -ForegroundColor Green
  } else {
    Write-Host "`nPushed. Follow the run in the GitHub repo > Actions tab." -ForegroundColor Green
  }
  exit 0
}

# ---- Local deploy: SAM + AWS CLI (mirrors .github/workflows/deploy.yml) ------------------------------------------
foreach ($tool in @('aws', 'sam')) { if (-not (Have $tool)) { Fail "$tool is not installed or not on PATH (needed for -Local)" } }
$env:AWS_PROFILE = $Profile            # also used by scripts/deploy-web.mjs
$env:AWS_DEFAULT_REGION = 'us-east-1'
Step "Checking AWS profile '$Profile'"
Run 'aws' @('sts', 'get-caller-identity', '--profile', $Profile, '--query', 'Arn', '--output', 'text')

$googleId = $env:GOOGLE_CLIENT_ID
if (-not $googleId -and (Test-Path .env)) {
  $line = Get-Content .env | Where-Object { $_ -match '^GOOGLE_CLIENT_ID=' } | Select-Object -First 1
  if ($line) { $googleId = ($line -replace '^GOOGLE_CLIENT_ID=', '').Trim().Trim('"') }
}
if (-not $googleId) { Fail 'GOOGLE_CLIENT_ID is not set (environment variable or .env)' }

Confirm-Go "Deploy the working tree to AWS stack 'pigeon-post' with profile '$Profile'?"

Step 'Reading the Google client secret from SSM'
$secret = (aws ssm get-parameter --name /pigeon/google-client-secret --with-decryption --query Parameter.Value --output text --profile $Profile --region us-east-1).Trim()
if ($LASTEXITCODE -ne 0 -or -not $secret) { Fail 'could not read /pigeon/google-client-secret from SSM' }

$overrides = @("GoogleClientId=$googleId", "GoogleClientSecret=$secret")
if ($env:SES_SENDER_EMAIL) { $overrides += "SesSenderEmail=$($env:SES_SENDER_EMAIL)" }
if ($env:BEDROCK_MODEL_ID) { $overrides += "BedrockModelId=$($env:BEDROCK_MODEL_ID)" }
if ($env:DOMAIN) { $overrides += "Domain=$($env:DOMAIN)" }
if ($env:HOSTED_ZONE_ID) { $overrides += "HostedZoneId=$($env:HOSTED_ZONE_ID)" }
if ($PermissionsBoundaryArn) { $overrides += "PermissionsBoundaryArn=$PermissionsBoundaryArn" }

Step 'sam build'
$env:PATH = (Join-Path $PSScriptRoot 'api\node_modules\.bin') + ';' + $env:PATH   # esbuild lives in api/devDependencies
Run 'sam' @('build')
Step 'Smoke-testing the Lambda bundles'
Run 'node' @('scripts/smoke-bundles.mjs')
Step 'sam deploy'
Run 'sam' (@('deploy', '--profile', $Profile, '--no-confirm-changeset', '--no-fail-on-empty-changeset', '--parameter-overrides') + $overrides)
Step 'Building and publishing the site (S3 + CloudFront invalidation)'
Run 'node' @('scripts/deploy-web.mjs')
Write-Host "`nDeployed. Hard-refresh the site (and on phones, reload twice) to get the new build." -ForegroundColor Green
