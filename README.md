# MusicStreamingApp Backend

This repository contains the backend for the MusicStreamingApp — a small Node.js + Express API that serves music records and accepts uploads for audio and cover images. The backend handles file parsing, computes audio duration, stores media in a Supabase storage bucket, and persists song metadata to the database.

**Key Responsibilities**

- Provide REST endpoints to list and retrieve songs.
- Accept uploads (audio + image) and compute audio duration server-side.
- Store media files in Supabase storage and save metadata in the database.

**Tech Stack**

- Node.js
- Express
- Supabase JS client (for DB + storage)
- multer (for multipart/form-data parsing)
- music-metadata (to compute audio duration)

**Environment**
Create a `.env` file or provide the following environment variables securely (do not commit them):

- `SUPABASE_URL` — your Supabase project URL
- `SUPABASE_KEY` — service role or appropriate key (keep this secret)
- `PORT` — port the server should listen on (optional; default often 3000)
- `NODE_ENV` — `development` or `production`

Do not store any secrets in the repository or paste credentials into issue trackers.

**Running Locally (PowerShell)**

```
cd MusicStreamingApp_Backend
npm install
# create a .env file with the variables listed above
# start the server (replace with your project's start script if different)
node server.js
```

**API Endpoints (examples)**

- `GET /api/music` — Return a list of songs (only public metadata fields).
- `GET /api/music/:id` — Return a single song by id.
- `POST /api/music/upload` — Upload a new song (multipart/form-data).
  - Required form fields: `music` (audio file), `song` (string)
  - Optional form fields: `image` (cover image), `year` (number), `label` (string), `copyright_text` (string)
  - The server computes audio `duration` and returns stored metadata including `media_url` and `image` URL.

When uploading, ensure the request uses `Content-Type: multipart/form-data` and that only one audio file is included (the server expects a single `music` file and at most one `image`).

**Notes & Recommendations**

- Validate file types and sizes before accepting uploads in production.
- Use short-lived or signed URLs for private media if desired; current setup may use public URLs depending on Supabase bucket configuration.
- Keep your Supabase keys and other secrets out of source control and rotate keys if they are exposed.

If you want, I can add a short example `curl` or Postman example for the upload endpoint (without secrets) and add validation middleware for file types and sizes.
