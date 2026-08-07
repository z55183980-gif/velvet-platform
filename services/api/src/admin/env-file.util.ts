import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const ALLOWED_ENV_NAMES = new Set(['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']);

function envFilePath(): string {
  const override = (process.env.VELVET_ENV_FILE || '').trim();
  if (override) return path.resolve(override);
  return path.join(process.cwd(), '.env');
}

function atomicWriteText(filePath: string, text: string) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.env.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
    try {
      fs.renameSync(tmp, filePath);
    } catch (renameErr: any) {
      // Windows: rename may fail if destination exists — fall back to copy+unlink.
      if (renameErr?.code === 'EEXIST' || renameErr?.code === 'EPERM' || renameErr?.code === 'EACCES') {
        fs.copyFileSync(tmp, filePath);
        fs.unlinkSync(tmp);
      } else {
        throw renameErr;
      }
    }
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/**
 * Atomically rewrite selected keys in the deployment `.env`, then mirror into
 * `process.env` for the current worker (same approach as zai admin).
 */
export function writeEnvValues(updates: Record<string, string>) {
  const filtered: Record<string, string> = {};
  for (const [name, value] of Object.entries(updates)) {
    if (!ALLOWED_ENV_NAMES.has(name)) {
      throw new Error(`Env write not allowed for ${name}`);
    }
    if (value.includes('\n') || value.includes('\r') || value.includes('\0')) {
      throw new Error(`Invalid env value for ${name}`);
    }
    filtered[name] = value;
  }
  if (!Object.keys(filtered).length) return;

  const filePath = envFilePath();
  let lines: string[] = [];
  try {
    if (fs.existsSync(filePath)) {
      lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
      if (lines.length && lines[lines.length - 1] === '') lines.pop();
    }
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }

  const seen = new Set<string>();
  const output: string[] = [];
  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith('#') || !line.includes('=')) {
      output.push(line);
      continue;
    }
    const eq = line.indexOf('=');
    const name = (eq >= 0 ? line.slice(0, eq) : line).trim();
    if (name in filtered) {
      output.push(`${name}=${filtered[name]}`);
      seen.add(name);
    } else {
      output.push(line);
    }
  }
  for (const [name, value] of Object.entries(filtered)) {
    if (!seen.has(name)) output.push(`${name}=${value}`);
  }

  atomicWriteText(filePath, output.join(os.EOL) + os.EOL);
  for (const [name, value] of Object.entries(filtered)) {
    process.env[name] = value;
  }
}
