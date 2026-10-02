/**
 * TASKS-02 Task 2 gate – selection sweep on real PDFs, read through the debug overlay (?debug=text) and
 * data-testid="captured-text". NOT RUN (no browsers here). The synthetic-layout equivalents live in src/tests/glyphMap.test.ts.
 * Fixtures still to be created by hand (see tests/fixtures/README.md): two-column, table, scanned+OCR, ligatures,
 * Devanagari, rotated/CropBox pages, pages with earlier edits.
 */
import { expect, test, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:4173";
const EXPECTED_WORDS = ["Fixture", "page", "1", "–", "confidential-token-1", "The", "quick", "brown", "fox", "jumps", "over", "the", "lazy", "dog."];

async function openEditText(page: Page, fixture: string) {
  await page.goto(`${BASE}/?e2e=1&debug=text`);
  await page.setInputFiles('input[type="file"]', `tests/fixtures/${fixture}`);
  await expect(page.getByRole("document")).toBeVisible();
  await page.evaluate(() => localStorage.setItem("qf-tour", "done"));
  await page.keyboard.press("e");
  await expect(page.getByTestId("debug-overlay")).toBeVisible();
}

test("selection sweep: clicking the centre of every word captures exactly that word", async ({ page }) => {
  await openEditText(page, "simple.pdf");
  const words = page.locator('[data-testid="debug-overlay"] rect[stroke="#16a34a"]');
  const n = await words.count();
  expect(n).toBe(EXPECTED_WORDS.length);
  const captured: string[] = [];
  for (let i = 0; i < n; i++) {
    const b = (await words.nth(i).boundingBox())!;
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    captured.push((await page.getByTestId("captured-text").textContent()) ?? "");
    // first glyph and last glyph of the word must capture the same word, never a neighbour
    for (const dx of [1.5, b.width - 1.5]) {
      await page.mouse.click(b.x + dx, b.y + b.height / 2);
      expect(await page.getByTestId("captured-text").textContent()).toBe(captured[i]);
    }
  }
  expect(captured).toEqual(EXPECTED_WORDS); // zero extra characters, in reading order
});

test("negative: blank margins and the gap between lines capture nothing", async ({ page }) => {
  await openEditText(page, "simple.pdf");
  const box = (await page.locator("[data-page-index='0']").boundingBox())!;
  for (const [x, y] of [[4, 4], [box.width - 4, box.height - 4], [box.width / 2, box.height * 0.8]]) {
    await page.mouse.click(box.x + x, box.y + y);
    expect(await page.getByTestId("captured-text").textContent()).toBe("");
  }
});

test("label shows the captured string and character count before editing; edit changes only that word", async ({ page }) => {
  await openEditText(page, "simple.pdf");
  const words = page.locator('[data-testid="debug-overlay"] rect[stroke="#16a34a"]');
  const b = (await words.nth(6).boundingBox())!; // "quick"
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.getByRole("group", { name: "Captured text" })).toContainText("“quick” · 5 chars");
  await page.getByRole("button", { name: /Edit ⏎/ }).click();
  await page.getByLabel("Object text").fill("slow");
  await page.getByRole("button", { name: /^⇩ Download/ }).click();
  await page.getByRole("button", { name: /export & download/i }).click();
  await expect(page.getByText(/Re-parsed with pdf\.js/)).toBeVisible();
  await expect(page.getByText(/text outside your edit changed/)).toHaveCount(0); // post-edit verification passed (no rollback)
});

test("shift+click extends, handles nudge by one character, Esc clears", async ({ page }) => {
  await openEditText(page, "simple.pdf");
  const words = page.locator('[data-testid="debug-overlay"] rect[stroke="#16a34a"]');
  const a = (await words.nth(6).boundingBox())!;
  const c = (await words.nth(7).boundingBox())!;
  await page.mouse.click(a.x + a.width / 2, a.y + a.height / 2);
  await page.keyboard.down("Shift");
  await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2);
  await page.keyboard.up("Shift");
  expect(await page.getByTestId("captured-text").textContent()).toBe("quick brown");
  await page.getByRole("button", { name: "End one character earlier" }).click();
  expect(await page.getByTestId("captured-text").textContent()).toBe("quick brow");
  await page.keyboard.press("Escape");
  expect(await page.getByTestId("captured-text").textContent()).toBe("");
});
