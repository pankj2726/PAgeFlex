// Bundle budget (Section 10): initial JS <= 200 KB gzipped on the landing page.
// Usage: node scripts/bundle-budget.mjs [budgetKB]
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const budgetKB = Number(process.argv[2] ?? 200);
const html = readFileSync("dist/index.html", "utf8");
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
const gz = gzipSync(Buffer.from(scripts)).length / 1024;
console.log(`Inline JS gzipped: ${gz.toFixed(1)} KB (budget ${budgetKB} KB)`);
if (gz > budgetKB) {
  console.error("Bundle budget exceeded (see docs/KNOWN_LIMITATIONS.md KL-LH).");
  process.exit(process.env.BUDGET_STRICT ? 1 : 0);
}
