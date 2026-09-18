# YouTube Channel Finder — temporary test build

Next.js 15 + TypeScript + Youtube138/RapidAPI.

## Features

- Channel URL search
- Videos / Shorts / Live streams
- Keyword search
- Cursor pagination
- Copy URLs
- CSV export
- Light theme
- Download button

## Start

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## API keys

The primary Youtube138/RapidAPI key is read only from the server-side `RAPIDAPI_KEY` environment variable. Never commit a real key to Git.

For reliability, channel video listing now has an optional fallback to the official YouTube Data API v3. Set `YOUTUBE_DATA_API_KEY` on the server. The fallback uses the channel uploads playlist and preserves cursor pagination. Downloads continue to use Youtube138 because the YouTube Data API does not provide downloadable media stream URLs.

### Vercel

1. Create a new RapidAPI key and revoke/rotate any key that was previously committed to the repository.
2. In Vercel, open **Project Settings → Environment Variables**.
3. Add `RAPIDAPI_KEY` with the new key for the environments you deploy to.
4. Optionally add `YOUTUBE_DATA_API_KEY` for the channel-video fallback.
5. Redeploy the project.

For local development, copy `.env.example` to `.env.local` and put the keys there.

## Download

The download route calls Youtube138 `/video/streaming-data/`, prefers a progressive MP4 containing video + audio, and proxies it back with `Content-Disposition: attachment`.

Large files may be constrained by Vercel/serverless function limits; this is intended for temporary testing.
