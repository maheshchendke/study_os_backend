# StudyOS backend

Express + raw SQL + MySQL API for the existing React/Vite frontend. Accounts use
MySQL-backed sessions; passwords are scrypt hashes and session tokens are stored
as SHA-256 hashes. Authenticated requests are scoped through the session's user
ID. No ORM is used.

## Requirements

- Node.js 20 or newer
- MySQL 8
- An OpenAI-compatible AI provider key/model only if AI chat is required

## Database setup and migration

For a new database, apply the schema (and optional seed if desired):

```powershell
Get-Content backend/database/schema.sql | mysql -u root -p
Get-Content backend/database/seed.sql | mysql -u root -p
```

For an existing StudyOS database, apply the additive, repeatable auth migration:

```powershell
Set-Location backend
npm run migrate:auth
```

The migration adds nullable `users.password_hash` and the `user_sessions` table.
It preserves existing users and study data. Rows from the former shared
development account stay in that legacy account and are not automatically
assigned to a newly registered user.

Copy `backend/.env.example` to `backend/.env` for local development. Set the
database values for your MySQL instance. Optional Gemini credentials belong in
backend environment variables only. `.env` files are ignored by Git.

## Run locally

```powershell
Set-Location backend
npm install
npm run dev
```

Run production mode with `npm start`. The API listens on `PORT` (default 5000
for local development) and allows the configured `CLIENT_URL` origin (default
`http://localhost:5173`). Production startup requires explicit `PORT`,
`CLIENT_URL`, `DB_HOST`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`. `CLIENT_URL`
must be the exact HTTPS frontend origin in production.

`COOKIE_SAME_SITE=lax` is suitable when frontend and API are same-site. Use
`COOKIE_SAME_SITE=none` only when the frontend and API are on separate
cross-site HTTPS hosts. State-changing API calls validate the request origin.

The frontend uses `VITE_API_URL` and defaults to `/api`. Vite proxies that path
to `http://localhost:5000` during development; set `BACKEND_DEV_URL` to change
the local target. For separate production hosts, set `VITE_API_URL` to the
public HTTPS API base URL ending in `/api`. It must not contain credentials.

## Authentication API

- `POST /api/auth/register`: `name`, `email`, and password (12–128 characters).
- `POST /api/auth/login`: `email` and `password`.
- `POST /api/auth/logout`: revokes the current session.
- `GET /api/auth/me`: restores the safe current-user profile.
- Other `/api` routes require a valid session cookie. The cookie is HTTP-only,
  scoped to `/api`, expires after seven days, and is Secure in production.
- Session data is server-side in MySQL. The browser never supplies the owner ID;
  existing services and SQL continue to use `req.user.id` from authentication.

## Verification

```powershell
Invoke-RestMethod http://localhost:5000/api/health
```

Health checks Express and the configured MySQL connection. Responses use
`{ success, data, message }`; errors return safe messages and codes. AI requests
use only the authenticated user's study data and keep the provider key on the
backend.

## Existing API surface

`/api/health`, `/api/dashboard`, `/api/profile`, `/api/subjects`, `/api/topics`,
`/api/tasks`, `/api/tasks/stats`, `/api/notes`, `/api/goals`, `/api/habits`,
`/api/study-plans`, `/api/pomodoros`, `/api/notifications`, `/api/analytics`,
`/api/placement`, `/api/leaderboard`, and `/api/ai/chat` remain available after
authentication.
