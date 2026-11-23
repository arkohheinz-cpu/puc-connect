# PUC Connect

A student directory built with React, TypeScript, Vite, Express, and SQLite. Profiles and account records are stored in `data/students.sqlite` on the computer running the API.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Run locally

1. Open a terminal in this project folder.
2. Install dependencies: `npm install`
3. Start the API and web app: `npm run dev`
4. Open the URL printed by Vite (normally `http://localhost:5173`).

The API is available at `http://127.0.0.1:3001`. In development, Vite proxies `/api` requests to it. To create a production frontend, run `npm run build`; `npm start` serves the built app and API on `http://127.0.0.1:3001`.

## Accounts and profile access

- The directory and profile pages require sign-in. Anyone can register, but each account must verify its email before signing in.
- Passwords must be at least 8 characters (up to 128); letters, numbers, symbols, and any combination are accepted. Passwords are stored as salted scrypt hashes.
- Email verification uses single-use links that expire after 24 hours. Existing accounts must verify once after this upgrade; a valid login attempt will send their link.
- Sessions use random, server-stored tokens in `HttpOnly` cookies, expire after seven days, and can be ended by signing out.
- Profile writes are authenticated and each account can create and edit only its own profile. The API also checks CSRF tokens, limits sign-in/registration attempts, and applies security response headers.
- Existing profiles are kept but are unclaimed and cannot be edited by a new account. They are never automatically assigned based only on matching, unverified email addresses.

## Hosting securely

The server binds to `127.0.0.1` by default. To host it, place it behind an HTTPS reverse proxy and set `NODE_ENV=production` so cookies are marked `Secure`. Set `HOST=0.0.0.0` only when the proxy needs network access to the app. Set `TRUST_PROXY_HOPS` to the exact number of trusted proxy hops (usually `1` for one reverse proxy); do not trust arbitrary client-supplied forwarding headers.

Configure email delivery before using registration:

- `SMTP_HOST`, `SMTP_PORT`, and `SMTP_FROM` are required.
- Set `SMTP_USER` and `SMTP_PASSWORD` together when the server requires authentication.
- Port 465 uses TLS by default; other ports require STARTTLS. Set `SMTP_SECURE=true` for implicit TLS on a different port.
- `PUBLIC_APP_URL` is the app's public base URL, such as `https://directory.example.com`; production requires HTTPS. In development the link uses the requesting localhost app origin when available (normally Vite at `http://localhost:5173`).

Keep SMTP credentials in environment variables or a secrets manager, never in source control. Production startup fails if the SMTP or public URL settings are missing or invalid. In development, if email delivery is unavailable, the API logs the failure and the sign-in page offers a one-click verification link after the user enters the correct password; verification then signs them in automatically. The resend page directs local users to this password-checked flow. Never use development links as a production email service.

The SQLite store and sign-in throttling are designed for a single server process and a trusted persistent disk. Do not run multiple replicas against this file-backed database. The in-memory sign-in rate limit resets when the process restarts. Configure backups and restrict filesystem access to the database.

Set `DATABASE_PATH` to use a different absolute database path. Uploaded profile photos are stored as data URLs in SQLite. This starter app does not provide password recovery, MFA, or account invitations.
