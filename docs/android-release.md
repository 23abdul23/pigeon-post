# Android release

`.github/workflows/android.yml` builds a signed App Bundle and uploads it to the Google Play **internal** track as a draft. It never touches any other track. It needs JDK 21 (Capacitor 8).

`.github/workflows/android-ci.yml` runs `./gradlew assembleDebug` on every pull request so the native plugin and service are compiled before merge. It uses no secrets.

## Repository secrets (Settings, Secrets and variables, Actions)

| Name | Purpose |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64 of the upload keystore file |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias inside the keystore |
| `ANDROID_KEY_PASSWORD` | Key password |
| `PLAY_SERVICE_ACCOUNT_JSON` | Full JSON of the Play API service account |

## Repository variables (non-secret)

| Name | Purpose |
| --- | --- |
| `VITE_COGNITO_USER_POOL_ID` | Cognito user pool id (stack output) |
| `VITE_COGNITO_CLIENT_ID` | Cognito app client id (stack output) |
| `VITE_COGNITO_DOMAIN` | Cognito hosted UI domain (stack output) |
| `VITE_API_URL` | API base URL (stack output) |
| `VITE_PUSH_ENABLED` | `true` or `false`; defaults to `false` when unset |

The release job fails before building if any of the four Cognito/API variables is empty or still contains `REPLACE_ME`, or if `VITE_PUSH_ENABLED` is `true` without `android/app/google-services.json`.

## One-time setup

1. Create the upload keystore (keep the file and passwords in a password manager, never in the repo):

   ```
   keytool -genkeypair -v -storetype PKCS12 -keystore <upload.keystore> -alias <key-alias> \
     -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 <upload.keystore>   # paste the output into ANDROID_KEYSTORE_BASE64
   ```

2. Enrol in Play App Signing when creating the app in the Play Console (Setup, App signing). Google holds the app signing key; the keystore above is only the upload key, and can be reset through Play support if lost.
3. Create the Play API service account: Google Cloud console, create a service account in the project linked to Play, create a JSON key. In Play Console, Users and permissions, invite the service account email and grant release permissions (Release apps to testing tracks; add production release only if you later automate it). Store the JSON in `PLAY_SERVICE_ACCOUNT_JSON`.
4. Create the app `app.pigeonpost` in the Play Console and upload the first bundle manually if Play requires it before API access works.

## Releasing

```
git tag android-v1.0.0 && git push origin android-v1.0.0
```

Or run the workflow from the Actions tab (`workflow_dispatch`) on `main`; manual runs on any other branch are skipped. The version code is the workflow run number; the version name is the tag without the `android-v` prefix (or `1.0` for manual runs) and must match `^[0-9A-Za-z._-]+$`. Tests (`npx vitest run`, `npm --prefix api test`, `npx tsc -b`) run before anything is built.

The upload uses `status: draft` because a new Play app must keep drafts until the store listing is complete. Once the listing is approved, change `status: draft` to `status: completed` in the workflow.

## Promotion (manual, in the Play Console)

internal testing, then closed testing (5-10 testers, about a week), then production with a staged rollout. The workflow deliberately cannot do this.

## Push notifications

Keep `VITE_PUSH_ENABLED` at `false` until Firebase `google-services.json` and the Gradle google-services plugin are in place and a device test has passed. If you add it later, supply `android/app/google-services.json` at build time from a secret (decode it in a workflow step, like the keystore) and never commit it.

## Pre-release checklist (human decisions)

- Resolve the UNCONFIRMED three.js bird licences (README, credits) before any public track.
- Legal review of the draft privacy, terms and delete pages, and confirm the `privacy@pigeonpost.app` mailbox exists.
- Obtain the commercial Open-Meteo key (`OpenMeteoApiKey`).
- Add a per-user throttle on `/weather`.
- Set the FCM secret and `FcmServiceAccountSecretArn`.
- Complete the Data safety form, content rating, and 13+ target audience.
- Fill in EU trader details.
- Listen-test the AAC coos on Safari and Android.
- Device test matrix: Pixel, Samsung and a low-end phone, covering the foreground-service flight, the Back button and the share sheet.

## Hardening to consider

- Pin third-party actions to full commit SHAs instead of major tags.
- Run the job in a GitHub environment with required reviewers and tag restrictions, so only approved tags can reach the signing secrets.
- Uncomment the keystore ignore lines in `android/.gitignore`.
