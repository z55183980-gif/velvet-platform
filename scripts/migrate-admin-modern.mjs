/**
 * Mechanical migrate: drop AdminLayout/admin-path/ui shims → AdminShell + @velvet/ui + t()
 * Run: node scripts/migrate-admin-modern.mjs
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("apps/admin/app");

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(ent.name)) out.push(p);
  }
  return out;
}

for (const file of walk(root)) {
  let s = fs.readFileSync(file, "utf8");
  const orig = s;

  // Drop old imports we'll rebuild
  s = s.replace(/import\s+\{[^}]*\}\s+from\s+"@\/components\/admin\/AdminLayout";\n?/g, "");
  s = s.replace(/import\s+\{[^}]*\}\s+from\s+"@\/components\/ui\/button";\n?/g, "");
  s = s.replace(/import\s+\{\s*adminPath\s*\}\s+from\s+"@\/lib\/admin-path";\n?/g, "");
  s = s.replace(/import\s+\{\s*useLocale\s*\}\s+from\s+"@\/lib\/i18n";\n?/g, "");

  // Ensure velvet ui + shell + i18n
  const needsFmt =
    /\bfmtNum\b/.test(s) || /\bfmtDate\b/.test(s) || /\bbuttonVariants\b/.test(s) || /\bInput\b/.test(s);
  const needsHours = /\bhoursAgo\b/.test(s);
  const needsShell = /\bAdminLayout\b/.test(s) || /\bAdminShell\b/.test(s) || file.includes(`${path.sep}login${path.sep}`) === false;
  const needsT = /\bt\(/.test(s) || /AdminLayout|AdminShell/.test(orig);

  const imports = [];
  if (needsShell && !file.endsWith(`${path.sep}login${path.sep}page.tsx`) && !file.includes(`${path.sep}login${path.sep}`)) {
    imports.push('import { AdminShell } from "@/components/admin-shell";');
  }
  if (needsT) imports.push('import { t } from "@/lib/i18n";');

  const uiParts = new Set();
  if (/\bbuttonVariants\b/.test(s)) uiParts.add("buttonVariants");
  if (/\bfmtNum\b/.test(s)) uiParts.add("fmtNum");
  if (/\bfmtDate\b/.test(s)) uiParts.add("fmtDate");
  if (/\bInput\b/.test(s) && /from "@velvet\/ui"/.test(orig) === false) {
    // only if Input used as component - keep if already from velvet
  }
  if (needsHours) uiParts.add("hoursAgo");
  // Always pull buttonVariants if page had buttons
  if (/\bbuttonVariants\b/.test(orig) || /\bbuttonVariants\b/.test(s)) uiParts.add("buttonVariants");
  if (/\bfmtNum\b/.test(orig)) uiParts.add("fmtNum");
  if (/\bfmtDate\b/.test(orig)) uiParts.add("fmtDate");

  if (uiParts.size) {
    imports.push(`import { ${[...uiParts].join(", ")} } from "@velvet/ui";`);
  }

  // Insert imports after "use client" and any remaining first imports block start
  if (imports.length) {
    const useClient = s.match(/^"use client";\s*\n/);
    let insertAt = useClient ? useClient[0].length : 0;
    // skip if already present
    const block = imports.filter((line) => !s.includes(line)).join("\n");
    if (block) s = s.slice(0, insertAt) + block + "\n" + s.slice(insertAt);
  }

  s = s.replace(/\bAdminLayout\b/g, "AdminShell");
  s = s.replace(/adminPath\(\s*`([^`]+)`\s*\)/g, "`$1`");
  s = s.replace(/adminPath\(\s*["']([^"']+)["']\s*\)/g, '"$1"');
  s = s.replace(/const\s*\{\s*locale\s*,\s*t\s*\}\s*=\s*useLocale\(\);\s*\n?/g, "");
  s = s.replace(/const\s*\{\s*locale\s*\}\s*=\s*useLocale\(\);\s*\n?/g, "");
  s = s.replace(/const\s*\{\s*t\s*\}\s*=\s*useLocale\(\);\s*\n?/g, "");
  s = s.replace(/const\s+zh\s*=\s*locale\s*===\s*["']zh["'];\s*\n?/g, "const zh = true;\n");
  if (!/const zh = true/.test(s) && /\bzh\b/.test(s)) {
    // ensure zh exists if used
    s = s.replace(/export default function[^{]+\{/, (m) => `${m}\n  const zh = true;`);
  }
  s = s.replace(/t\(\s*["']admin\.(\w+)["']\s*\)/g, 't("$1")');

  // Deduplicate identical import lines
  const lines = s.split("\n");
  const seen = new Set();
  const deduped = [];
  for (const line of lines) {
    if (line.startsWith("import ") && seen.has(line)) continue;
    if (line.startsWith("import ")) seen.add(line);
    deduped.push(line);
  }
  s = deduped.join("\n");

  if (s !== orig) {
    fs.writeFileSync(file, s);
    console.log("ok", path.relative(process.cwd(), file));
  }
}
console.log("done");
