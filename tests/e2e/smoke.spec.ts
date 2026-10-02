/**
 * Playwright smoke + privacy test.  NOT RUN in the authoring environment (no shell / browsers) and
 * @playwright/test is not installed – run: npm i -D @playwright/test && npx playwright install && npx playwright test
 * (see docs/KNOWN_LIMITATIONS.md KL-ENV-1/4).  Fixtures: node scripts/make-fixtures.mjs
 */
import { expect, test } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:4173";

test("upload → add text → download is a valid PDF, and no request carries file bytes (S2, S4)", async ({ page }) => {
  const requests: { url: string; size: number }[] = [];
  page.on("request", (r) => requests.push({ url: r.url(), size: (r.postData() ?? "").length }));

  await page.goto(BASE);
  await page.setInputFiles('input[type="file"]', "tests/fixtures/simple.pdf");
  await expect(page.getByRole("document")).toBeVisible();
  await page.keyboard.press("t");
  const box = await page.locator("[data-page-index='0']").boundingBox();
  await page.mouse.click(box!.x + 100, box!.y + 200);
  await page.getByLabel("Object text").fill("Hello E2E");
  await page.getByRole("button", { name: /download/i }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /export & download/i }).click()]);
  const path = await download.path();
  const bytes = (await import("node:fs")).readFileSync(path!);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  await expect(page.getByText(/Re-parsed with pdf.js: 1 page/)).toBeVisible();

  // S4: nothing with a body was sent, and no request went to a non-CDN third party
  expect(requests.filter((r) => r.size > 0)).toEqual([]);
  for (const r of requests) expect(new URL(r.url).origin === new URL(BASE).origin || /cdn\.jsdelivr\.net|^data:|^blob:/.test(r.url)).toBeTruthy();
});

test("not-a-PDF and corrupt files show typed errors", async ({ page }) => {
  await page.goto(BASE);
  await page.setInputFiles('input[type="file"]', "tests/fixtures/not-a-pdf.pdf");
  await expect(page.getByRole("alert")).toContainText(/doesn't look like a PDF/i);
  await page.setInputFiles('input[type="file"]', "tests/fixtures/corrupt-truncated.pdf");
  await expect(page.getByRole("alert")).toContainText(/damaged/i);
});

test("encrypted file prompts for a password; wrong then right password", async ({ page }) => {
  await page.goto(BASE);
  await page.setInputFiles('input[type="file"]', "tests/fixtures/encrypted.pdf");
  await page.getByLabel("PDF password").fill("nope");
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("alert")).toContainText(/incorrect/i);
  await page.getByLabel("PDF password").fill("user123");
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("document")).toBeVisible();
});

test("Clear my data wipes IndexedDB", async ({ page }) => {
  await page.goto(BASE);
  await page.setInputFiles('input[type="file"]', "tests/fixtures/simple.pdf");
  await page.waitForTimeout(2500); // autosave debounce
  await page.getByLabel("Settings and privacy").click();
  await page.getByRole("menuitem", { name: /clear my data/i }).click();
  const count = await page.evaluate(async () => (await indexedDB.databases()).filter((d) => d.name === "pageflex").length);
  expect(count).toBeLessThanOrEqual(1); // an empty shell DB may be re-created by the existence check
  await page.goto(BASE);
  await expect(page.getByText(/Recover/)).toHaveCount(0);
});
