// Generates the license-safe fixture corpus (blueprint §9) into tests/fixtures/ using pdf-lib only.
// Usage: node scripts/make-fixtures.mjs
// NOT YET RUN in the authoring environment (no shell) – see docs/KNOWN_LIMITATIONS.md KL-ENV-1.
// Fixtures that need real-world files (scanned image-only, non-Latin embedded fonts, subset fonts, large images,
// linearized, attachments) must be added by hand: see tests/fixtures/README.md.
import { mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, degrees } from "@cantoo/pdf-lib";

const out = "tests/fixtures";
mkdirSync(out, { recursive: true });
const save = (name, bytes) => (writeFileSync(`${out}/${name}`, bytes), console.log("wrote", name, bytes.length));

async function text(pages, size = [595.28, 841.89]) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = d.addPage(size);
    p.drawText(`Fixture page ${i + 1} – confidential-token-${i + 1}`, { x: 50, y: size[1] - 80, size: 18, font: f });
    p.drawText("The quick brown fox jumps over the lazy dog.", { x: 50, y: size[1] - 120, size: 12, font: f });
  }
  return d;
}

save("simple.pdf", await (await text(1)).save());
save("multi-page-300.pdf", await (await text(300)).save());

{
  const d = await text(3);
  [90, 180, 270].forEach((r, i) => d.getPage(i).setRotation(degrees(r)));
  save("rotated.pdf", await d.save());
}
{
  const d = await PDFDocument.create();
  [[595, 842], [842, 595], [300, 300], [612, 792]].forEach(([w, h], i) => d.addPage([w, h]).drawText(`size ${w}x${h}`, { x: 20, y: h - 40, size: 14 }));
  save("mixed-sizes.pdf", await d.save());
}
{
  const d = await text(2);
  d.getPage(0).setCropBox(50, 100, 400, 500);
  save("cropbox.pdf", await d.save());
}
{
  const d = await text(2);
  d.encrypt({ userPassword: "user123", ownerPassword: "owner123", permissions: { printing: true, copying: false } });
  save("encrypted.pdf", await d.save({ useObjectStreams: false }));
}
{
  const d = await PDFDocument.create();
  const page = d.addPage([595, 400]);
  const form = d.getForm();
  const name = form.createTextField("full_name");
  name.addToPage(page, { x: 50, y: 330, width: 250, height: 24 });
  form.createCheckBox("agree").addToPage(page, { x: 50, y: 280, width: 18, height: 18 });
  const dd = form.createDropdown("country");
  dd.addOptions(["India", "Brazil", "Japan"]);
  dd.addToPage(page, { x: 50, y: 230, width: 200, height: 24 });
  const rg = form.createRadioGroup("plan");
  rg.addOptionToPage("free", page, { x: 50, y: 180, width: 16, height: 16 });
  rg.addOptionToPage("pro", page, { x: 120, y: 180, width: 16, height: 16 });
  save("acroform.pdf", await d.save());
}
save("corrupt-truncated.pdf", (await (await text(3)).save()).slice(0, 700));
writeFileSync(`${out}/not-a-pdf.pdf`, "This is plain text pretending to be a PDF.\n");
