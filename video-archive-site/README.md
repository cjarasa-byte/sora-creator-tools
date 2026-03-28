# Video Archive Site (Read-Only)

This is a **separate, standalone static website** for browsing Sora videos from exported CSV data.
It is intentionally **not part of the Chrome extension runtime** and is ignored by Chrome extension loading because it is not listed in `manifest.json`.

## Purpose

- Host a read-only catalog of videos/posts from exported Sora Creator Tools analytics.
- Keep all data local in the browser session (no writes back to extension storage, no external API calls).
- Allow future CSV schema tweaks without changing extension behavior.

## Input CSV

Primary support is for `Export all data CSV` from the dashboard.
The site reads the `=== POSTS SUMMARY (Latest Snapshot Per Post) ===` section and maps columns such as:

- `User Handle`
- `Post ID`
- `Post URL`
- `Backend Post URL`
- `Caption`
- `Thumbnail URL`
- `Post Time (ISO)`
- `Latest Snapshot Timestamp`
- `Unique Views`, `Total Views`, `Likes`, `Comments`, `Remixes`, `Interaction Rate %`

Optional media columns are also supported if you add them later to exports:

- `Video URL`
- `Media URL`
- `MP4 URL`

If present, `Video URL/Media URL/MP4 URL` becomes the primary card click target.

## Local usage

From repo root:

```bash
python3 -m http.server 4173
```

Then open:

- `http://localhost:4173/video-archive-site/`

## Suggested deploy targets

Because this is static HTML/CSS/JS, you can deploy directly to any static host:

- GitHub Pages
- Cloudflare Pages
- Netlify
- Vercel static export
- S3 + CloudFront

## Read-only guarantee

- No storage writes
- No mutation endpoints
- No authentication flows
- No extension APIs

This keeps the site as a simple presentation layer for exported data.
