# LinkedIn Saved Navigator

A Chrome/Edge extension that lets you index and search LinkedIn saved posts directly on LinkedIn's saved-posts page.

## What it does

- Injects a right sidebar on `linkedin.com/my-items/saved-posts`.
- Runs guided sync for lazy-loaded saved posts (LinkedIn loads a small chunk, then more after scrolling).
- Stores posts in local IndexedDB with dedupe by stable id.
- Supports text search and metadata filters:
  - author
  - date range
  - month
  - day of week
  - day of month
  - content type
- Opens original post URL from results.

## Install (Developer Mode)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select folder: `D:\Opensource_repos\linkedin-saved-navigator`.

## How to use

1. Open LinkedIn saved posts page:
   - `https://www.linkedin.com/my-items/saved-posts/`
2. Use the `Saved Navigator` button on the right.
3. Click `Start Sync`.
4. Keep the tab open while sync runs. The extension will auto-scroll and index newly loaded cards.
5. Use search and filters in the same sidebar.
6. Click `Open` on any result to jump to the original LinkedIn post.

## Notes on reliability

- LinkedIn UI selectors can change; extractor uses fallback selectors.
- Sync ends after repeated cycles with no new cards found.
- Re-running sync is safe; records are upserted by id.

## Run tests

```bash
npm test
```
