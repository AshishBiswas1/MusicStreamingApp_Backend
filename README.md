# MusicStreamingApp Backend

This repository contains the backend for the MusicStreamingApp — a Node.js + Express API that serves music, podcasts, and user activity tracking. The backend provides endpoints for music streaming, podcast discovery (via ListenNotes API), recently-played tracking, and user authentication.

**Key Responsibilities**

- Provide REST endpoints to list, retrieve, and upload songs.
- Search and fetch podcast data from ListenNotes API with episode details.
- Track recently-played music and podcasts for authenticated users.
- Save and retrieve user's podcast library with automatic episode updates.
- Maintain podcast listening history with timestamps.
- Accept uploads (audio + image) and compute audio duration server-side.
- Store media files in Supabase storage and save metadata in the database.

**Tech Stack**

- Node.js
- Express
- Supabase JS client (for DB + storage)
- ListenNotes API (via `podcast-api` client)
- multer (for multipart/form-data parsing)
- music-metadata (to compute audio duration)
- zod (for request validation)

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

**API Endpoints**

### Music Endpoints (`/api/music`)

- `GET /api/music` — Return a list of songs (only public metadata fields).
- `GET /api/music/:id` — Return a single song by id.
- `POST /api/music/upload` — Upload a new song (multipart/form-data).
  - Required form fields: `music` (audio file), `song` (string)
  - Optional form fields: `image` (cover image), `year` (number), `label` (string), `copyright_text` (string)
  - The server computes audio `duration` and returns stored metadata including `media_url` and `image` URL.

When uploading, ensure the request uses `Content-Type: multipart/form-data` and that only one audio file is included (the server expects a single `music` file and at most one `image`).

### Podcast Endpoints (`/api/podcast`)

All podcast endpoints require authentication (`Authorization: Bearer <token>`).

- `GET /api/podcast` — Fetch best podcasts from ListenNotes (genre: Technology) with episodes.

  - Query params: `page` (optional, default 1)
  - Returns podcasts sorted by listen score, each with episode details (id, title, audio URL, duration, publish date).

- `GET /api/podcast/search` — Search podcasts by name via ListenNotes.

  - Query params: `q` (required, search query), `page` (optional, default 1)
  - Returns matching podcasts with their episodes sorted oldest→newest by publish date.

- `POST /api/podcast` — Save a podcast to the user's library.

  - Body: `{ id, title, publisher, image, episodes: [{ id, title, audio, audio_length_sec, pub_date_ms }] }`
  - Upserts podcast record and inserts new episodes only (avoids duplicates).
  - Associates podcast with authenticated user (`user_id`).

- `GET /api/podcast/getSavedPodcast` — Retrieve all saved podcasts for the authenticated user.

  - Returns podcast records with `episodes` as an array of episode IDs.

- `GET /api/podcast/getOneSavePodcast/:id` — Fetch a single saved podcast with latest episode sync.

  - Fetches latest podcast data from ListenNotes.
  - Inserts the newest episode if missing in the database.
  - Returns the saved podcast with all episodes populated and sorted oldest→newest.

- `POST /api/podcast/setHistory` — Record or update podcast listening history.

  - Body: `{ podcast_id, episode_id, watched }` (watched is optional integer)
  - Updates `played_at` timestamp if history entry exists; otherwise inserts new record.

- `GET /api/podcast/getHistory` — Retrieve user's podcast listening history.
  - Returns history entries ordered by most recent first.
  - Each entry includes populated podcast details (title, image) and episode info (title, audio, duration, publish date).

### Recently Played Endpoints (`/api/recently-played`)

All recently-played endpoints require authentication.

- `POST /api/recently-played/music` — Track a played song.

  - Body: `{ song_id }` (UUID)
  - Updates `played_at` if the song was already played by this user; otherwise inserts a new record.

- `GET /api/recently-played/music` — Retrieve recently played music for the user.

  - Returns entries ordered by most recent first.
  - Each entry includes `song_id` populated with the full song record from the `songs` table.

- `POST /api/recently-played/podcast` — Track a played podcast.

  - Body: `{ podcast_id }` (string)
  - Updates `played_at` if the podcast was already played by this user; otherwise inserts a new record.

- `GET /api/recently-played/podcast` — Retrieve recently played podcasts for the user.
  - Returns entries ordered by most recent first.
  - Each entry includes `podcast_id` (original ID string) and `podcast` field populated with the full podcast record (or `null` if not found).

**Notes & Recommendations**

- **Authentication**: Most endpoints require a valid JWT token in the `Authorization: Bearer <token>` header.
- **ListenNotes API**: The backend uses the ListenNotes API (API key: managed in `podcastController.js`) to fetch podcast data. Rate limiting and retry logic with exponential backoff are implemented to handle 429 responses.
- **Episode Sorting**: Podcast episodes are sorted oldest→newest by publish date in search and single-podcast endpoints.
- **Database Tables**:
  - `songs` — music tracks
  - `podcast` — saved podcasts with `episode` text array (episode IDs) and `user_id`
  - `episodes` — podcast episode details
  - `podcast_history` — listening history with `watched` count
  - `recently_played_music` — tracks played songs per user
  - `recently_played_podcast` — tracks played podcasts per user
- **File Validation**: Validate file types and sizes before accepting uploads in production.
- **Media URLs**: Use short-lived or signed URLs for private media if desired; current setup may use public URLs depending on Supabase bucket configuration.
- **Security**: Keep your Supabase keys, ListenNotes API key, and other secrets out of source control and rotate keys if they are exposed.

**Database Indexes**

The following indexes are recommended for optimal performance:

- `recently_played_music`: indexes on `user_id`, `song_id`, and `played_at DESC`
- `recently_played_podcast`: indexes on `user_id`, `podcast_id`, and `played_at DESC`
- `podcast_history`: indexes on `user_id` and `created_at DESC`

**Example Requests**

Search for podcasts:

```powershell
curl -Uri "http://localhost:3000/api/podcast/search?q=technology" -Headers @{ Authorization = "Bearer <token>" }
```

Track a played song:

```powershell
curl -Uri "http://localhost:3000/api/recently-played/music" -Method POST -Body (ConvertTo-Json @{ song_id = "your-song-uuid" }) -ContentType "application/json" -Headers @{ Authorization = "Bearer <token>" }
```

Get recently played music:

```powershell
curl -Uri "http://localhost:3000/api/recently-played/music" -Headers @{ Authorization = "Bearer <token>" }
```
