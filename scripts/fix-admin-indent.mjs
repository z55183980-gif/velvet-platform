import fs from "node:fs";
import path from "node:path";

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.tsx$/.test(e.name) ? [p] : [];
  });
}

for (const f of walk("apps/admin/app")) {
  let s = fs.readFileSync(f, "utf8");
  const orig = s;
  // Fix broken indent after injected `const zh = true;`
  s = s.replace(/const zh = true;\nconst /g, "const zh = true;\n  const ");
  s = s.replace(/\n{3,}/g, "\n\n");
  // Remove unused AdminShell import from non-page shells if any leftover on layout-like
  if (s !== orig) {
    fs.writeFileSync(f, s);
    console.log("fixed indent", f);
  }
}
console.log("done");
