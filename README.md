# LinkedIn Saved Navigator

A Chrome/Edge extension that lets you index and search LinkedIn saved posts directly on LinkedIn's saved-posts page.

## What it does

- Injects a right sidebar on `linkedin.com/my-items/saved-posts`.
- Runs guided sync for lazy-loaded saved posts (LinkedIn loads a small chunk, then more after scrolling).
- Uses end-of-feed detection that waits for repeated no-growth cycles near bottom before marking sync complete.
- Stores posts in local IndexedDB with dedupe by stable id.
- Supports text search and metadata filters:
  - author
  - date range
  - month
  - day of week
  - day of month
  - content type
- Opens original post URL from results.
- Optional `Return all matches` mode to fetch all filtered results at once.
- Includes a `Data Health` panel to verify indexed data quality (author/text/date coverage and sample rows).

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

## Browser E2E (real LinkedIn page)

This project includes Playwright scripts that exercise the extension on the real saved-posts page.

1. Install dependencies:

```bash
npm install
```

2. Bootstrap authenticated profile (manual one-time login):

```bash
npm run test:e2e:bootstrap
```

3. Run real-page E2E:

```bash
npm run test:e2e:linkedin
```

Environment variables:
- `LSN_E2E_PROFILE_DIR`: persistent browser profile directory.
- `LSN_E2E_EXTENSION_DIR`: unpacked extension path (defaults to repo root).
- `LSN_E2E_TARGET_URL`: defaults to `https://www.linkedin.com/my-items/saved-posts/`.
- `LSN_E2E_TIMEOUT_MS`: E2E timeout in ms (default `120000`).
- `LSN_E2E_EXPECT_MIN_INDEXED`: require minimum indexed posts during run (default `0`).

Notes:
- These E2E scripts use a real browser and real LinkedIn session.
- If LinkedIn redirects to login during E2E, run bootstrap again and complete login.
