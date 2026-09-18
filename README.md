# X-DOWNLOAD — YouTube Channel Downloader

Next.js 15 + TypeScript + RapidAPI YouTube Media Downloader.

## Provider

This build uses the RapidAPI **YouTube Media Downloader** provider at `youtube-media-downloader.p.rapidapi.com`. The provider exposes channel listing at `/v2/channel/videos` and full video details/download URLs at `/v2/video/details`. It also supports subtitle conversion through `/v2/video/subtitles`.

## Features

- Channel URL search (`@handle`, `/channel/UC...`, `/user/...`, `/c/...`)
- Videos / Shorts / Live streams
- Provider pagination with `nextToken`
- Automatic handling for unusually large pagination tokens through `/v2/misc/list-items`
- Keyword/date filtering of loaded videos
- Copy URLs and CSV export
- Direct video URL download
- Download selection prefers a progressive video stream that already contains audio

## Environment

Create `.env.local` locally or configure the same variable in Vercel: 

```env
YOUTUBE_MEDIA_RAPIDAPI_KEY=your_rapidapi_key
```

Do not commit the real RapidAPI key to the repository.

## Start

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Why the provider responses look different

The examples you supplied are from different endpoints in the same API:

- `/v2/video/details` returns one video and can include `videos`, `audios`, `subtitles`, and `related`.
- `/v2/video/subtitles` returns subtitle data in the format requested (for example JSON/SRT/VTT/XML depending on parameters).
- `/v2/channel/videos` returns a list under `items` plus a `nextToken` for pagination.

The app uses `/v2/channel/videos` for the channel dashboard and `/v2/video/details` for the actual download stream.

## Download behavior

The download route asks for normal URL access, receives the provider's time-limited media URL, selects the best available progressive stream with audio, then proxies that stream back to the browser as a file download.

Large downloads may still be constrained by your hosting platform's serverless function limits because the app currently proxies the media through the server.
