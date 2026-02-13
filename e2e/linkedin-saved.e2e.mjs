import path from "node:path";
import { chromium } from "playwright";

const profileDir =
  process.env.LSN_E2E_PROFILE_DIR || path.resolve(process.cwd(), "e2e", ".profile", "linkedin-auth");
const extensionDir = process.env.LSN_E2E_EXTENSION_DIR || process.cwd();
const targetUrl = process.env.LSN_E2E_TARGET_URL || "https://www.linkedin.com/my-items/saved-posts/";
const timeoutMs = Number(process.env.LSN_E2E_TIMEOUT_MS || 120000);
const expectMinIndexed = Number(process.env.LSN_E2E_EXPECT_MIN_INDEXED || 0);

function requireCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForIndexedAtLeast(page, minValue, timeout) {
  if (minValue <= 0) return 0;
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const progressText = await page.locator("#lsn-progress").textContent();
    const match = String(progressText || "").match(/Indexed:\s*(\d+)/i);
    const indexed = match ? Number(match[1]) : 0;
    if (indexed >= minValue) {
      return indexed;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(`Expected at least ${minValue} indexed posts before timeout`);
}

async function main() {
  console.log(`[LSN E2E] Using profile dir: ${profileDir}`);
  console.log(`[LSN E2E] Using extension dir: ${extensionDir}`);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  });

  try {
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });

    const currentUrl = page.url();
    requireCondition(
      currentUrl.includes("/my-items/saved-posts/"),
      `Not on saved posts page. Current URL: ${currentUrl}. Run npm run test:e2e:bootstrap first.`,
    );

    await page.waitForSelector("#lsn-root", { timeout: timeoutMs });
    await page.waitForSelector("#lsn-panel", { timeout: timeoutMs });
    console.log("[LSN E2E] Sidebar injected.");

    await page.click("#lsn-start");
    await page.waitForTimeout(3000);

    const status = await page.locator("#lsn-status-pill").textContent();
    requireCondition(
      ["running", "completed", "paused", "idle"].includes(String(status || "").trim().toLowerCase()),
      `Unexpected sync status value: ${status}`,
    );

    const indexed = await waitForIndexedAtLeast(page, expectMinIndexed, timeoutMs);
    console.log(`[LSN E2E] Indexed posts observed: ${indexed}`);

    await page.fill("#lsn-q", "");
    await page.click("#lsn-search");
    await page.waitForSelector("#lsn-results-list", { timeout: timeoutMs });
    const resultsMeta = await page.locator(".lsn-results-meta").textContent();
    requireCondition(Boolean(resultsMeta), "Results meta text is missing");
    console.log(`[LSN E2E] Results meta: ${resultsMeta}`);

    console.log("[LSN E2E] Completed successfully.");
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error("[LSN E2E] Failed:", error);
  process.exitCode = 1;
});
