# sora-dl (local CLI companion)

A local-only CLI subproject for downloading Sora asset URLs in batch without running the Chrome extension UI.

> This folder is intentionally separate from extension runtime files. Chrome only executes files declared in `manifest.json`, so this subproject is ignored by extension behavior.

## Quick start

```bash
cd sora-dl
node --check sora-dl.js
node sora-dl.js --help
```

## Usage

### Download one file

```bash
node sora-dl.js download \
  --url "https://sora.chatgpt.com/path/to/video.mp4" \
  --out "./downloads/video.mp4"
```

### Batch download from text file

`urls.txt` format:

```txt
https://sora.chatgpt.com/.../a.mp4
https://cdn.openai.com/.../b.mp4
```

Run:

```bash
node sora-dl.js batch --input ./urls.txt --dir ./downloads --concurrency 3
```

### Mark completed downloads (dedupe)

A state file is written to `.state/downloaded.json` so repeated runs skip completed URLs.

## Notes

- By default, only `sora.chatgpt.com` and `*.openai.com` URLs are allowed.
- Use `--allow-any-host` to disable host restrictions.
- No external npm dependencies are required.
