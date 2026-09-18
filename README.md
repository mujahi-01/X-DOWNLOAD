# YouTube Channel Finder — temporary test build

Next.js + TypeScript + Youtube138/RapidAPI.

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

## Temporary API key

The supplied RapidAPI key is hardcoded only in the server-side API routes for this temporary test build. It is not exposed as `NEXT_PUBLIC_*`. Rotate and move it to an environment variable before production/public deployment.

## Download

The download route calls Youtube138 `/video/streaming-data/`, prefers a progressive MP4 containing video + audio, and proxies it back with `Content-Disposition: attachment`.

Large files may be constrained by Vercel/serverless function limits; this is intended for temporary testing.
