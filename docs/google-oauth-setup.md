# Setting up "Continue with Google"

"Continue with Google" stays disabled (the button explains why) until the server has a Google OAuth client. The
flow is described in [authentication.md](authentication.md#google-sign-in-openid-connect).

## 1. Create the OAuth client

1. Open Google Cloud Console → **APIs & Services**.
2. **OAuth consent screen**: choose *External*, set the app name (Isker), support email, and add the scopes
   `openid`, `email`, `profile` (no sensitive scopes are needed). While the app is in *Testing*, only listed test
   users can sign in; publish it for everyone.
3. **Credentials → Create credentials → OAuth client ID → Web application**.
4. **Authorized redirect URIs** — add the exact callback URL of every environment, for example:
   - `http://localhost:5173/api/auth/google/callback` (Vite dev server, which proxies `/api` to the backend)
   - `http://localhost:8080/api/auth/google/callback` (Docker single-container image)
   - `https://<your-domain>/api/auth/google/callback` (production)

   Google requires an exact match: scheme, host, port and path.
5. Copy the **Client ID** and **Client secret**.

## 2. Configure the backend

Set environment variables (never in frontend code; the secret is only used server to server):

```
GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
# Optional. Default: {APP_BASE_URL}/api/auth/google/callback
GOOGLE_REDIRECT_URI=
APP_BASE_URL=https://<your-domain>
```

On Render, add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the service's Environment settings (they are declared
in `render.yaml` with `sync: false`). Restart the service.

`GET /api/auth/providers` should now return `"google": true` and the button on the sign-in page becomes active.

## 3. Check it

1. Open `/login`, tick "Remember me" if you want a persistent session, click **Continue with Google**.
2. Choose a Google account. A new account is created with the learner role and you land on onboarding.
3. Sign out and sign in with Google again: you return to the same account.
4. With an existing password account: sign in with the password, open Settings → Google sign-in → **Link Google**.

Typical errors:

| Shown to the user | Cause |
|---|---|
| "Google sign-in is not configured on this server." / disabled button | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` missing |
| `redirect_uri_mismatch` on Google's page | the callback URL isn't registered exactly (check scheme/port/path and `APP_BASE_URL`) |
| "The Google sign-in session expired or is invalid." | state cookie missing/expired (10 minutes), the flow started in another browser, or the link was reused |
| "An account with this email already exists…" | expected: sign in with the password and link Google in Settings |
| "Your Google email isn't verified…" | the Google account's email is unverified |

## Security notes

- Secrets stay on the server; the frontend only navigates to `/api/auth/google/start`.
- `state` (cookie-bound, single use, 10 min), `nonce` and PKCE are always used.
- The ID token is verified (signature with Google's keys, `iss`, `aud`, `exp`, `iat`, `nonce`).
- Accounts are matched by Google's `sub`, never by email alone; Google never grants roles.
- Authentication failures are audited without tokens or authorization codes.
