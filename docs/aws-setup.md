# AWS setup (Task 0 checklist)

Fill in by hand. IDs, ARNs and names only; never secret values (those go in SSM).

| Item | Value |
| --- | --- |
| AWS account ID | TODO |
| CLI profile name (expected `pigeon`) | TODO |
| Budget alert email | TODO |
| Google OAuth client ID | TODO |
| Bedrock model (access granted) | TODO |
| SES verified sender | TODO |

## SSM parameters (us-east-1)

| Name | Created |
| --- | --- |
| `/pigeon/google-client-secret` | TODO |
| other `/pigeon/*` parameters | TODO |

## Checks

- [ ] `aws sts get-caller-identity --profile pigeon` prints the user ARN
- [ ] `aws budgets describe-budgets --account-id <id> --profile pigeon` lists a 5 USD monthly budget with the email above
- [ ] Bedrock shows "Access granted" for the model above
- [ ] `aws ses get-identity-verification-attributes --identities <sender> --profile pigeon` prints `Success`
- [ ] `aws ssm get-parameter --name /pigeon/google-client-secret --profile pigeon` succeeds (value masked)
- [ ] `node -v` (20+), `sam --version`, `aws --version` print versions

## Sign-in (Task 2)

- Deploy passes `GoogleClientId` and `GoogleClientSecret` (read from SSM `/pigeon/google-client-secret`); see the comment on the parameters in `template.yaml`.
- Add the stack output `GoogleRedirectUri` (`https://pigeon-post-<account-id>.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`) to the Google OAuth client's authorized redirect URIs.
- `.env.production` holds placeholder `VITE_COGNITO_*` / `VITE_API_URL` values. Replace them with stack outputs `UserPoolId`, `UserPoolClientId`, `CognitoDomain`, `ApiUrl` before building for deploy. They are not secrets.
- Local dev without `VITE_COGNITO_*` keeps the offline mock sign-in.
