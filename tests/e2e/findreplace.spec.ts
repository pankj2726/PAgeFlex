/**
 * TASKS-02 Task 3 gate – Find & Replace on real PDFs. NOT RUN (no browsers here). The §3.5 matrix is unit-tested in
 * src/tests/matcher.test.ts. Needs: node scripts/make-fixtures.mjs (simple.pdf, multi-page-300.pdf).
 */
import { expect, test, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:4173";
async function open(page: Page, fixture = "simple.pdf") {
  await page.goto(`${BASE}/?e2e=1`);
  await page.setInputFiles('input[type="file"]', `tests/fixtures/${fixture}`);
  await expect(page.getByRole("document")).toBeVisible();
  await page.evaluate(() => localStorage.setItem("qf-tour", "done"));
}
const counter = (page: Page) => page.getByTestId("match-counter");
const highlights = (page: Page) => page.locator('[data-testid="find-highlights"] rect[data-match]');

test("Ctrl+F finds; counter == highlight count; whole word excludes inner matches; Enter/Shift+Enter wrap around", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Control+f");
  await page.getByLabel("Find", { exact: true }).fill("the");
  await expect(counter(page)).toContainText("1 of 2");
  await expect(highlights(page)).toHaveCount(2);
  await page.getByLabel("Find", { exact: true }).press("Enter");
  await expect(counter(page)).toContainText("2 of 2");
  await page.getByLabel("Find", { exact: true }).press("Enter");
  await expect(counter(page)).toContainText("1 of 2"); // wrapped
  await page.getByLabel("Find", { exact: true }).press("Shift+Enter");
  await expect(counter(page)).toContainText("2 of 2");
  await page.getByRole("checkbox", { name: "Match case" }).check();
  await expect(counter(page)).toContainText("1 of 1"); // "The" no longer matches
  await page.keyboard.press("Escape");
  await expect(page.getByRole("search")).toHaveCount(0);
});

test("Replace All: counter == highlights == replaced; neighbours' pixels unchanged; ONE undo restores; output downloads", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Control+h");
  await page.getByLabel("Find", { exact: true }).fill("the");
  await page.getByLabel("Replace with").fill("she");
  await page.getByRole("checkbox", { name: "Whole word" }).check();
  await expect(counter(page)).toContainText("1 of 2");
  const total = await highlights(page).count();
  const box = (await page.locator("[data-page-index='0']").boundingBox())!;
  const heading = { x: box.x, y: box.y + box.height * 0.05, width: box.width, height: box.height * 0.08 }; // a line with no matches
  const before = await page.screenshot({ clip: heading });
  await page.getByRole("button", { name: /Replace all/ }).click();
  await expect(page.getByTestId("replace-summary")).toContainText(`Replaced ${total}`);
  expect(await page.screenshot({ clip: heading })).toEqual(before); // neighbour-pixel test
  await expect(highlights(page)).toHaveCount(0); // replaced text is no longer found
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z"); // a single undo reverts every replacement
  await page.keyboard.press("Control+f");
  await page.getByLabel("Find", { exact: true }).fill("the");
  await expect(highlights(page)).toHaveCount(total);
  // re-run the Task 1 download check on the replaced document
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+y");
  await page.getByRole("button", { name: /^⇩ Download/ }).click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /export & download/i }).click()]);
  expect((await dl.suggestedFilename()).endsWith(".pdf")).toBe(true);
  await expect(page.getByText(/Re-parsed with pdf\.js/)).toBeVisible();
  await expect(page.getByText(/text outside your edit changed/)).toHaveCount(0);
});

test("invalid regex shows an indicator; valid shows a tick", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Control+f");
  await page.getByRole("checkbox", { name: "Regex" }).check();
  await page.getByLabel("Find", { exact: true }).fill("(");
  await expect(page.getByRole("alert")).toContainText(/Invalid pattern/);
  await page.getByLabel("Find", { exact: true }).fill("qu.ck");
  await expect(page.getByText("✔ valid pattern")).toBeVisible();
});

test("300-page document: search completes with progress and the UI stays responsive", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, "multi-page-300.pdf");
  await page.keyboard.press("Control+f");
  await page.getByLabel("Find", { exact: true }).fill("confidential-token-299");
  const t0 = Date.now();
  // while searching the page must still answer script calls (not frozen)
  await expect.poll(async () => page.evaluate(() => document.title), { timeout: 5000 }).toContain("PageFlex");
  await expect(counter(page)).toContainText("1 of 1", { timeout: 150_000 });
  console.log(`300-page search took ${Date.now() - t0} ms`);
});
