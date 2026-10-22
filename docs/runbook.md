# Runbook

Region `us-east-1`, stack `pigeon-post`. Local commands use the `pigeon` profile (`--profile pigeon`); CI uses the OIDC role.

## One-time setup: CI deploy role

CI has no AWS keys. It assumes an IAM role through GitHub's OIDC provider. The role lives in its own small stack, `deploy-role.yaml`, deployed once by you with the admin profile. It is deliberately not in `template.yaml`: a role that can edit its own stack could widen its own permissions.

```
aws cloudformation deploy --template-file deploy-role.yaml --stack-name pigeon-post-deploy-role \
  --capabilities CAPABILITY_NAMED_IAM --profile pigeon --region us-east-1 \
  --parameter-overrides CreateGithubOidcProvider=true
aws cloudformation describe-stacks --stack-name pigeon-post-deploy-role --query "Stacks[0].Outputs" --profile pigeon
```

- An account can hold only one OIDC provider for `token.actions.githubusercontent.com`. If another project already created it (`aws iam list-open-id-connect-providers`), pass `CreateGithubOidcProvider=false` and the role will trust the existing one.
- Other parameters: `GithubRepo` (default `23abdul23/pigeon-post`), `GithubBranch` (default `main`), `StackName`, and `HostedZoneId` (only if you use a Route 53 domain; without it the role has no Route 53 access).
- Trust policy: `aud = sts.amazonaws.com` and `sub` exactly `repo:23abdul23/pigeon-post:ref:refs/heads/main`. Pull requests, forks, tags and other branches cannot assume it.
- The role is not admin. It manages only `pigeon-post*` resources where AWS allows naming them, may create only IAM roles named `pigeon-post-*` that carry the permissions boundary `pigeon-post-lambda-boundary`, and can pass them only to Lambda. Tradeoffs where scoping is impossible are commented next to each statement in `deploy-role.yaml`: CloudFront distributions, HTTP APIs, Cognito user pools and ACM certificates are covered account-wide because their ids exist only after creation (Cognito is limited to management actions, no user data access).
- If you add a Lambda permission in `template.yaml` that the boundary does not list (see `LambdaBoundary`), the Lambda will be denied at runtime. Update `deploy-role.yaml` with the admin profile and re-run the `deploy` command above.
- The role cannot delete the stack (`sam delete` is yours), cannot create the SAM managed artifact stack, and cannot change itself.

### First deploy must be local

Deploy the application stack once yourself so the `aws-sam-cli-managed-default` artifact stack exists and your existing roles get the boundary:

```
sam build
sam deploy --profile pigeon --parameter-overrides GoogleClientId=<id> SesSenderEmail=<sender or ''> \
  GoogleClientSecret=$(aws ssm get-parameter --name /pigeon/google-client-secret --with-decryption --query Parameter.Value --output text --profile pigeon) \
  PermissionsBoundaryArn=<PermissionsBoundaryArn output>
```

### GitHub repo variables

Repo Settings > Secrets and variables > Actions > **Variables** tab. None of these are secrets; do not create any AWS secrets.

| Variable | Example | Required |
| --- | --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::123456789012:role/github-deploy-pigeon-post` (stack output `DeployRoleArn`) | yes |
| `AWS_PERMISSIONS_BOUNDARY_ARN` | `arn:aws:iam::123456789012:policy/pigeon-post-lambda-boundary` (stack output `PermissionsBoundaryArn`) | yes |
| `GOOGLE_CLIENT_ID` | `1234-abc.apps.googleusercontent.com` | yes |
| `SES_SENDER_EMAIL` | `letters@example.com` (empty disables email letter alerts) | no |
| `AWS_REGION` | `us-east-1` (default) | no |
| `BEDROCK_MODEL_ID` | `us.anthropic.claude-haiku-4-5-20251001-v1:0` (template default) | no |
| `DOMAIN` | `pigeonpost.app` | no |
| `HOSTED_ZONE_ID` | `Z0123456789ABCDEFGHIJ` | no |

The Google client secret stays in SSM `/pigeon/google-client-secret`. The workflow reads it with the deploy role, masks it, and passes it as a `NoEcho` stack parameter (CloudFormation cannot resolve `ssm-secure` for the Cognito Google provider). Tradeoff: it sits in the deploy step's process arguments for the length of that step, on a runner that exists only for the job.

The workflow (`.github/workflows/deploy.yml`) runs tests on every push and pull request; only a push to `main` gets AWS credentials. Deploys are serialized (`concurrency: deploy`). Verify end to end by pushing a visible text change to `main` and checking `SiteUrl` after the run (pending: needs the setup above).

## Custom domain (optional)

1. Set `DOMAIN` (and `HOSTED_ZONE_ID` if the domain is hosted in Route 53) and re-deploy. With a zone, the certificate is validated and the A/AAAA alias records are created by the stack.
2. Without a zone, the stack pauses at the certificate. In ACM (us-east-1) copy the DNS validation CNAME to your DNS host; once it validates the stack continues. Then point `DOMAIN` at the stack output `CloudFrontDomain` (CNAME or ALIAS).
3. Manual, in Google Cloud Console (the stack cannot do this): on the OAuth client add `https://<domain>` to Authorized JavaScript origins. Cognito's callback and logout URLs, the API CORS origins and the letters bucket CORS already include the domain. The Google redirect URI is unchanged (it is the Cognito domain).
4. If you also run `deploy-role.yaml` with a Route 53 domain, re-deploy it with `HostedZoneId=<zone>` so the role may write the records.

`SiteUrl` shows the domain when set. Clearing `DOMAIN` removes the certificate, aliases and records.

## Roll back

Prefer fixing forward, but to go back to a known good commit:

```
git revert <bad-commit> && git push   # CI redeploys the previous behaviour
```

or locally: `git checkout <good-commit> && sam build && sam deploy --profile pigeon --parameter-overrides ...` (same overrides as the first deploy) then `node scripts/deploy-web.mjs`. CloudFormation also rolls back a failed update by itself. A stack stuck in `ROLLBACK_COMPLETE` after a failed first create must be deleted by you (`sam delete`) before redeploying.

## Read logs

```
sam logs --stack-name pigeon-post --name StateFunction --tail --profile pigeon
sam logs --stack-name pigeon-post --start-time '30min ago' --profile pigeon
```

Function names: `HealthFunction`, `StateFunction`, `MeFunction`, `CreateTripFunction`, `SessionsFunction`, `ReturnTripFunction`, `StoriesFunction`, `ComposeFunction`, `FriendsFunction`, `LettersFunction`, `UploadsFunction`, `AccountFunction`. Log groups are `/aws/lambda/pigeon-post-<name>` with 14 day retention. The `Api5xxAlarm` alarm fires on more than 5 API 5xx responses in 5 minutes.

## Reset a user

Easiest: the user signs in and uses **delete account** (`DELETE /me`), which removes their rows, their friends' rows about them, in-flight letters, attachments and the Cognito user.

By hand (admin), for a user with id `<sub>` (the Cognito `sub`, shown by `list-users`):

```
aws cognito-idp list-users --user-pool-id <UserPoolId> --filter 'email = "a@b.com"' --profile pigeon
aws dynamodb query --table-name <TableName> --key-condition-expression 'PK = :p' --expression-attribute-values '{":p":{"S":"USER#<sub>"}}' --projection-expression 'PK,SK' --profile pigeon
# delete each returned key with: aws dynamodb delete-item --table-name <TableName> --key '{"PK":{"S":"..."},"SK":{"S":"..."}}'
aws cognito-idp admin-delete-user --user-pool-id <UserPoolId> --username <sub> --profile pigeon
aws s3 rm s3://<LettersBucket>/letters/<sub>/ --recursive --profile pigeon
```

Keys are `USER#<sub>` / `PROFILE`, `TRIP#`, `FRIEND#`, `LETTER#` etc. (`api/src/lib/keys.ts`); note that friends' rows about the user live in the friends' partitions: prefer `DELETE /me`. To only force a fresh sign-in, run `aws cognito-idp admin-user-global-sign-out`. Table, pool and bucket names are stack outputs (`aws cloudformation describe-stacks --stack-name pigeon-post --query "Stacks[0].Outputs"`).

## Tear everything down

```
node scripts/empty-buckets.mjs && sam delete --stack-name pigeon-post --profile pigeon
```

(`AWS_PROFILE` selects the profile for the script; default `pigeon`.) Also delete, if you no longer want them: the `pigeon-post-deploy-role` stack (`aws cloudformation delete-stack`), the SSM parameter `/pigeon/google-client-secret`, and the GitHub repo variables.

### Leftover `aws-sam-cli-managed-default` stack

`sam deploy` (`resolve_s3`) creates this stack and its source bucket once per region, outside `pigeon-post`, so `sam delete` of the app does not remove it (it holds only uploaded build zips). To remove it: empty its bucket (`aws s3 rm s3://<aws-sam-cli-managed-default-samclisourcebucket-...> --recursive`; the bucket is versioned, so delete old versions too, or use the console "Empty"), then `aws cloudformation delete-stack --stack-name aws-sam-cli-managed-default --profile pigeon`. Other SAM projects in the account share it.

## Things that are easy to forget

- **Bundle smoke test is a deploy blocker**: after `sam build`, `node scripts/smoke-bundles.mjs` imports every built handler. A handler that fails to import (e.g. `Dynamic require of "node:https" is not supported`) crashes at Lambda init, so never deploy past a failure. The ESM bundles need the `Banner` (`createRequire`) in each function's `BuildProperties`; keep it on new functions.
- **Local `sam build` needs esbuild on PATH**: esbuild is an `api/` devDependency, so run `npm --prefix api ci` and put `api/node_modules/.bin` on PATH first (PowerShell: `$env:Path = (Resolve-Path api/node_modules/.bin).Path + ';' + $env:Path`), then `sam build --config-env ci`.

- **SES is optional**: leave `SES_SENDER_EMAIL` empty to disable email letter alerts (the in-app mailbox still delivers). **SES sandbox**: until AWS grants production access, "A letter arrived" emails go only to verified identities. Verify test recipients, or request production access in the SES console.
- **Bedrock model id**: confirm `BedrockModelId` (default `us.anthropic.claude-haiku-4-5-20251001-v1:0`) matches the inference profile with access granted in the Bedrock console; a wrong id makes story polish fail.
- **Google OAuth client**: Authorized redirect URI is the `GoogleRedirectUri` stack output; Authorized origins must include any custom domain (see above).
- **Budget**: the 5 USD monthly budget alarm from Task 0 is not part of the stack; keep it.
