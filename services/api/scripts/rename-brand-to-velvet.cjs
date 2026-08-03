const fs = require('fs');
const path = require('path');

const root = process.argv[2] || process.cwd();
const skipDir = new Set(['node_modules', '.embedded-pg', '.next', 'dist', 'storage', '.git']);
const exts = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.prisma', '.svg', '.css', '.example', '.env', '.html', '.txt']);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (skipDir.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else {
      const ext = path.extname(name);
      if (exts.has(ext) || name === '.env' || name.endsWith('.env.example')) out.push(p);
    }
  }
  return out;
}

function transform(s) {
  // Order matters: longest / most specific first. Case-sensitive only.
  return s
    .replaceAll('dramavn-platform', 'velvet-platform')
    .replaceAll('dramavn-api', 'velvet-api')
    .replaceAll('dramavn-web', 'velvet-web')
    .replaceAll('DramaVN', 'Velvet')
    .replaceAll('dramavn', 'velvet');
}

const files = walk(root);
let n = 0;
for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8');
  if (raw.includes("|| 'velvet'")) {
    console.log('SKIP corrupted:', f);
    continue;
  }
  const next = transform(raw);
  if (next !== raw) {
    fs.writeFileSync(f, next, 'utf8');
    n++;
    console.log('OK', path.relative(root, f));
  }
}
console.log(`done: ${n} files`);
