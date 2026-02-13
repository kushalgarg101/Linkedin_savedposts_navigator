import path from "node:path";
import { chromium } from "playwright";

const profileDir =
  process.env.LSN_E2E_PROFILE_DIR || path.resolve(process.cwd(), "e2e", ".profile", "linkedin-auth");

const extensionDir = process.env.LSN_E2E_EXTENSION_DIR || process.cwd();

async function main() {
  console.log(`[LSN E2E] Using profile dir: ${profileDir}`);
  console.log(`[LSN E2E] Using extension dir: ${extensionDir}`);
  console.log("[LSN E2E] A browser window will open. Log into LinkedIn and then close the window.");

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  });

  const page = await context.newPage();
  await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded" });
  console.log("[LSN E2E] Waiting for browser close...");
  await context.waitForEvent("close");
  console.log("[LSN E2E] Auth bootstrap completed.");
}

main().catch((error) => {
  console.error("[LSN E2E] Auth bootstrap failed:", error);
  process.exitCode = 1;
});
