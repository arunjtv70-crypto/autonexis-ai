# AUTONEXIS Assistant

AUTONEXIS Assistant is a React/Vite frontend with a FastAPI backend.

## Deploy the frontend to Vercel

Import this repository in Vercel and leave the project root set to `.`. The
root `vercel.json` installs and builds the app from `frontend/`, publishes
`frontend/dist`, and serves the React app for client-side routes.

Set `VITE_API_BASE_URL` in the Vercel project's Environment Variables to the
URL of your deployed API followed by `/api`, for example
`https://your-api.example.com/api`. Also set `VITE_GOOGLE_CLIENT_ID` if Google
sign-in is configured. Redeploy after adding or changing these variables.

## Deploy the API

Deploy `backend/` as a separate Vercel project using the same GitHub
repository and set that project's Root Directory to `backend`. Configure the
backend environment variables in the Vercel dashboard using `backend/.env.example`
as a guide. Set a strong, unique `JWT_SECRET` and your private `LLM_API_KEY`
there; do not add real credentials to GitHub or to variables prefixed with
`VITE_`.

The current backend defaults to SQLite. Vercel's function filesystem is not a
persistent database, so configure a supported persistent database before using
the deployed API for real accounts or chat history. Do not upload the local
`autonexis.db`.

## Run locally

- Frontend: `cd frontend`, install dependencies with `npm ci`, then run `npm run dev`.
- Backend: `cd backend`, install dependencies from `requirements.txt`, configure
  `.env` from `.env.example`, then run `uvicorn main:app --reload`.

Local `.env` files, databases, virtual environments, and generated build output
are intentionally excluded from the repository. Dependency lockfiles and
manifests are included so each deployment can install its own dependencies.
