/**
 * Bulk-transform copied admin pages to new stack imports.
 * Run: node scripts/transform-admin-pages.mjs
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("apps/admin/app");

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.name.endsWith(".tsx") || ent.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

const files = walk(root);
let n = 0;
for (const file of files) {
  let s = fs.readFileSync(file, "utf8");
  const orig = s;

  // Remove old admin layout import path leftovers
  s = s.replace(
    /import\s+\{\s*AdminLayout([^}]*)\}\s+from\s+"@\/components\/admin\/AdminLayout";?/g,
    'import { AdminShell$1} from "@/components/admin-shell";',
  );
  s = s.replace(/AdminLayout/g, "AdminShell");

  // API imports
  s = s.replace(/from\s+"@\/lib\/api"/g, 'from "@velvet/api-client"');

  // button
  s = s.replace(/from\s+"@\/components\/ui\/button"/g, 'from "@velvet/ui"');

  // admin-path helper → identity paths
  s = s.replace(/import\s+\{\s*adminPath\s*\}\s+from\s+"@\/lib\/admin-path";?\n?/g, "");
  s = s.replace(/adminPath\(\s*["'`]([^"'`]+)["'`]\s*\)/g, '"$1"');
  // template cases: adminPath(`/content?...`) already rare; handle `${adminPath("/x")}`
  s = s.replace(/\$\{adminPath\(\s*["'`]([^"'`]+)["'`]\s*\)\}/g, "$1");

  // i18n: useLocale → simple t
  if (s.includes('from "@/lib/i18n"') || s.includes("useLocale")) {
    s = s.replace(/import\s+\{\s*useLocale\s*\}\s+from\s+"@\/lib\/i18n";?\n?/g, 'import { t } from "@/lib/i18n";\n');
    // Remove `const { locale, t } = useLocale();` and `const { t } = useLocale();` and `const zh = locale === "zh";`
    s = s.replace(/const\s*\{\s*locale\s*,\s*t\s*\}\s*=\s*useLocale\(\);\s*\n?/g, "");
    s = s.replace(/const\s*\{\s*t\s*\}\s*=\s*useLocale\(\);\s*\n?/g, "");
    s = s.replace(/const\s+zh\s*=\s*locale\s*===\s*["']zh["'];\s*\n?/g, "const zh = true;\n");
    // t("admin.xxx") → t("xxx")
    s = s.replace(/t\(\s*["']admin\.(\w+)["']\s*\)/g, 't("$1")');
  }

  // fmtNum/fmtDate from AdminShell re-export or @velvet/ui
  s = s.replace(
    /import\s+\{\s*AdminShell\s*,\s*fmtNum\s*,\s*fmtDate\s*\}\s+from\s+"@\/components\/admin-shell";/g,
    'import { AdminShell } from "@/components/admin-shell";\nimport { fmtNum, fmtDate } from "@velvet/ui";',
  );
  s = s.replace(
    /import\s+\{\s*AdminShell\s*,\s*fmtNum\s*\}\s+from\s+"@\/components\/admin-shell";/g,
    'import { AdminShell } from "@/components/admin-shell";\nimport { fmtNum } from "@velvet/ui";',
  );
  s = s.replace(
    /import\s+\{\s*AdminShell\s*,\s*fmtDate\s*\}\s+from\s+"@\/components\/admin-shell";/g,
    'import { AdminShell } from "@/components/admin-shell";\nimport { fmtDate } from "@velvet/ui";',
  );

  if (s !== orig) {
    fs.writeFileSync(file, s);
    n++;
    console.log("updated", path.relative(process.cwd(), file));
  }
}
console.log(`done: ${n}/${files.length} files`);
