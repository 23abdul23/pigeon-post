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
