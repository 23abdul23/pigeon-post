# AWS setup (Task 0 checklist)

Fill in by hand. IDs, ARNs and names only; never secret values (those go in SSM).

| Item | Value |
| --- | --- |
| AWS account ID | TODO |
| CLI profile name (expected `pigeon`) | TODO |
| Budget alert email | TODO |
| Google OAuth client ID | TODO |
| Bedrock model (access granted) | TODO |
| SES verified sender (optional, empty = no email alerts) | TODO |

## SSM parameters (us-east-1)

| Name | Created |
| --- | --- |
| `/pigeon/google-client-secret` | TODO |
| other `/pigeon/*` parameters | TODO |

## Checks

- [ ] `aws sts get-caller-identity --profile pigeon` prints the user ARN
- [ ] `aws budgets describe-budgets --account-id <id> --profile pigeon` lists a 5 USD monthly budget with the email above
- [ ] Bedrock shows "Access granted" for the model above
- [ ] (only if using SES) `aws ses get-identity-verification-attributes --identities <sender> --profile pigeon` prints `Success`
- [ ] `aws ssm get-parameter --name /pigeon/google-client-secret --profile pigeon` succeeds (value masked)
- [ ] `node -v` (20+), `sam --version`, `aws --version` print versions

## Sign-in (Task 2)

- Deploy passes `GoogleClientId`, `GoogleClientSecret` (read from SSM `/pigeon/google-client-secret`) and `SesSenderEmail` (optional: the verified SES sender, or empty to disable email letter alerts; in the SES sandbox only verified recipient addresses receive mail; always pass it, since `sam deploy` keeps old values for omitted parameters); see the comment on the parameters in `template.yaml`.
- Add the stack output `GoogleRedirectUri` (`https://pigeon-post-<account-id>.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`) to the Google OAuth client's authorized redirect URIs.
- `.env.production` holds placeholder `VITE_COGNITO_*` / `VITE_API_URL` values. Replace them with stack outputs `UserPoolId`, `UserPoolClientId`, `CognitoDomain`, `ApiUrl` before building for deploy. They are not secrets.
- Local dev without `VITE_COGNITO_*` keeps the offline mock sign-in.

## Cross-device sync and place search

- New stack parameters, all optional (defaults are the free public services; no keys, nothing in SSM): `PhotonBaseUrl` (default `https://photon.komoot.io`), `OpenMeteoGeocodingUrl` (default `https://geocoding-api.open-meteo.com`), `GeocoderContact` (default empty; a URL or email added to the geocoder `User-Agent`). Pass them with `--parameter-overrides` only to swap an upstream (see the runbook, "Place search").
- New functions `FlightFunction` (`PUT`/`DELETE /flight`), `ImportFunction` (`POST /import`) and `PlacesFunction` (`GET /places/search`, `GET /places/reverse`); no new outputs. Table TTL (`ttl`) expires old flights, place cache and daily counters.
- No new AWS service or account setup: no Amazon Location Service, no geocoder API key.
