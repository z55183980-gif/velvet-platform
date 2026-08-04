import fs from "fs";
import path from "path";

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

const files = walk("d:/Velvet/velvet-platform/services/api/src");
const msgs = new Map();
const re =
  /new BizException\(\s*[^,]+,\s*(?:`([^`]+)`|'([^']+)'|"([^"]+)")/g;
for (const f of files) {
  const t = fs.readFileSync(f, "utf8");
  let m;
  while ((m = re.exec(t))) {
    const s = m[1] || m[2] || m[3];
    if (!s) continue;
    if (s.startsWith("auth.") || s.startsWith("common.")) continue;
    msgs.set(s, (msgs.get(s) || 0) + 1);
  }
}
const arr = [...msgs.entries()].sort((a, b) => b[1] - a[1]);
console.log("unique non-key messages:", arr.length);
console.log(arr.map(([s, c]) => `${c}\t${s}`).join("\n"));
