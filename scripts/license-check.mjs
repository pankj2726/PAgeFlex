// License audit (C4 / NF9): fails if any installed production dependency uses a copyleft licence.
// Usage: node scripts/license-check.mjs
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = "node_modules";
const allowed = /(MIT|ISC|BSD|Apache|MPL-2\.0|0BSD|Unlicense|CC0|BlueOak|Python-2\.0|CC-BY-4\.0)/i;
const denied = /(AGPL|(^|[^L])GPL|SSPL|Commons-Clause)/i;
const problems = [];
let count = 0;

function pkgDirs() {
  const out = [];
  for (const name of readdirSync(root)) {
    if (name.startsWith(".")) continue;
    if (name.startsWith("@")) {
      for (const sub of readdirSync(join(root, name))) out.push(join(root, name, sub));
    } else out.push(join(root, name));
  }
  return out;
}

for (const dir of pkgDirs()) {
  const file = join(dir, "package.json");
  if (!existsSync(file)) continue;
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  let lic = pkg.license ?? (Array.isArray(pkg.licenses) ? pkg.licenses.map((l) => l.type).join(" OR ") : undefined);
  if (typeof lic === "object" && lic) lic = lic.type;
  count++;
  if (!lic) {
    problems.push(`${pkg.name}: no license field`);
    continue;
  }
  // SPDX expressions with OR: acceptable if at least one permissive option exists (e.g. "(MIT OR GPL-3.0)" for jszip)
  const options = String(lic).replace(/[()]/g, "").split(/\s+OR\s+/i);
  const ok = options.some((o) => allowed.test(o) && !denied.test(o));
  if (!ok) problems.push(`${pkg.name}@${pkg.version}: ${lic}`);
}

console.log(`Checked ${count} packages.`);
if (problems.length) {
  console.error("Licence problems:\n" + problems.join("\n"));
  process.exit(1);
}
console.log("License audit passed: no AGPL/GPL-only dependencies.");
