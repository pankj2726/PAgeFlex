/**
 * TASKS-02 Task 1 gate: Download works after EVERY kind of edit, twice in a row, and survives a bad object.
 * NOT RUN in the authoring environment (no shell/browsers; @playwright/test not installed).
 *   npm i -D @playwright/test && npx playwright install && node scripts/make-fixtures.mjs && npm run build && npm run preview &
 *   npx playwright test tests/e2e/download.spec.ts --project=chromium --project=firefox --project=webkit
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:4173";
const open = async (page: Page, fixture = "simple.pdf") => {
  const logs: string[] = [];
  page.on("console", (m) => m.type() === "error" && logs.push(m.text()));
  page.on("pageerror", (e) => logs.push(`${e.message}\n${e.stack}`)); // Task 1.1: record exact console errors + stacks
  await page.goto(`${BASE}/?e2e=1`);
  await page.setInputFiles('input[type="file"]', `tests/fixtures/${fixture}`);
  await expect(page.getByRole("document")).toBeVisible();
  await page.evaluate(() => localStorage.setItem("qf-tour", "done"));
  const tour = page.getByRole("button", { name: "Skip" });
  if (await tour.isVisible().catch(() => false)) await tour.click();
  return logs;
};

/** Click Download → Export, assert a real PDF was saved and the second parser agrees. Returns the bytes. */
async function downloadAndValidate(page: Page, expectPages?: number) {
  await page.getByRole("button", { name: /^⇩ Download/ }).click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /export & download/i }).click()]);
  const bytes = readFileSync((await dl.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.subarray(-1024).toString("latin1")).toContain("%%EOF");
  await expect(page.getByText(/Re-parsed with pdf\.js: \d+ page/)).toBeVisible(); // validate output with a second parser
  if (expectPages) await expect(page.getByText(`Re-parsed with pdf.js: ${expectPages} page`)).toBeVisible();
  return bytes;
}

const addText = async (page: Page, text = "Hello E2E") => {
  await page.keyboard.press("t");
  const box = (await page.locator("[data-page-index='0']").boundingBox())!;
  await page.mouse.click(box.x + 120, box.y + 240);
  await page.getByLabel("Object text").fill(text);
};

const edits: [string, (p: Page) => Promise<void>, string?, number?][] = [
  ["text box", (p) => addText(p)],
  ["whiteout", async (p) => {
    await p.keyboard.press("w");
    const b = (await p.locator("[data-page-index='0']").boundingBox())!;
    await p.mouse.move(b.x + 60, b.y + 100);
    await p.mouse.down();
    await p.mouse.move(b.x + 220, b.y + 130);
    await p.mouse.up();
  }],
  ["edit existing text", async (p) => {
    await p.keyboard.press("e");
    const b = (await p.locator("[data-page-index='0']").boundingBox())!;
    await p.mouse.click(b.x + b.width * 0.12, b.y + b.height * 0.1); // lands on the first heading word
    await p.getByRole("button", { name: /Edit ⏎/ }).click();
    await p.getByLabel("Object text").fill("Replaced");
  }],
  ["delete a page", async (p) => {
    await p.getByRole("button", { name: /^Page 2/ }).click();
    await p.getByRole("button", { name: "Delete selected pages" }).click();
  }, "mixed-sizes.pdf", 3],
  ["rotate a page", async (p) => {
    await p.getByRole("button", { name: /^Page 1/ }).click();
    await p.getByRole("button", { name: "Rotate selected pages right" }).click();
  }],
  ["watermark", async (p) => {
    await p.getByRole("button", { name: /Tools/ }).click();
    await p.getByRole("menuitem", { name: /Add watermark/ }).click();
    await p.getByRole("button", { name: /^Add watermark/ }).click();
    await expect(p.getByText(/Watermark applied/)).toBeVisible();
  }],
  ["signature", async (p) => {
    await p.keyboard.press("g");
    await p.getByRole("tab", { name: "Type" }).click();
    await p.getByRole("textbox").first().fill("Ada Lovelace");
    await p.getByRole("button", { name: "Place on page" }).click();
  }],
  ["form fill", async (p) => {
    await p.getByRole("tab", { name: "Forms" }).click();
    await p.getByRole("textbox").first().fill("Ada");
    await p.getByRole("button", { name: "Apply values" }).click();
    await expect(p.getByText(/Form values saved/)).toBeVisible();
  }, "acroform.pdf"],
  ["merge", async (p) => {
    await p.getByRole("button", { name: /Tools/ }).click();
    await p.getByRole("menuitem", { name: /Merge PDF/ }).click();
    await p.locator('[role="dialog"] input[type="file"]').setInputFiles("tests/fixtures/mixed-sizes.pdf");
    await p.getByRole("button", { name: /^Merge/ }).click();
    await expect(p.getByText(/Merge PDFs applied/)).toBeVisible();
  }],
];

for (const [name, act, fixture, pages] of edits) {
  test(`download works after: ${name}`, async ({ page }) => {
    const logs = await open(page, fixture);
    await act(page);
    await downloadAndValidate(page, pages);
    expect(logs, `console errors:\n${logs.join("\n")}`).toEqual([]);
  });
}

test("downloading twice in a row works", async ({ page }) => {
  await open(page);
  await addText(page);
  await downloadAndValidate(page);
  const [second] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download again" }).click()]);
  expect(readFileSync((await second.path())!).subarray(0, 5).toString()).toBe("%PDF-");
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: /^⇩ Download/ }).click(); // and a whole second export
  const [third] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /export & download/i }).click()]);
  expect(readFileSync((await third.path())!).subarray(0, 5).toString()).toBe("%PDF-");
});

test("forced failure: a bad object is skipped, the PDF still downloads, and a warning lists it", async ({ page }) => {
  await open(page);
  await addText(page);
  await page.evaluate(() => {
    const s = (window as unknown as { __qf: { useEditor: { getState(): { doc: { pages: { id: string }[] }; liveUpdate(f: (d: unknown) => unknown): void } } } }).__qf.useEditor.getState();
    const pageId = s.doc.pages[0].id;
    s.liveUpdate((d: unknown) => ({ ...(d as object), objects: [...(d as { objects: unknown[] }).objects, { id: "bad1", pageId, type: "rect", x: Number.NaN, y: 10, w: 20, h: 20, rotation: 0, opacity: 1, color: "#f00", fill: null, strokeWidth: 1 }] }));
  });
  await downloadAndValidate(page, 1);
  await expect(page.getByRole("alert").filter({ hasText: /skipped/i })).toContainText(/not a finite number/);
});

test("the fallback link exists and points at a PDF blob", async ({ page }) => {
  await open(page);
  await addText(page);
  await downloadAndValidate(page);
  await expect(page.getByTestId("download-fallback")).toHaveAttribute("href", /^blob:/);
});
