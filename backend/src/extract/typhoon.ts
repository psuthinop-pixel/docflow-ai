// Typhoon OCR (opentyphoon.ai) via the typhoon-ocr Python package; returns plain text lines.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const SCRIPT = 'import sys; from typhoon_ocr import ocr_document; print(ocr_document(sys.argv[1]))';

export const typhoonEnabled = () => !!process.env.TYPHOON_OCR_API_KEY;

export function markdownToText(md: string): string {
  return md
    .replace(/<\/t[dh]>/gi, '  ')
    .replace(/<\/tr>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\|/g, ' ')
    .replace(/[*#`]/g, '');
}

async function ocrOnce(buf: Buffer, mime: string): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'typhoon-'));
  const file = path.join(dir, `in.${EXT[mime] ?? 'bin'}`);
  try {
    writeFileSync(file, buf);
    const { stdout } = await run('python3', ['-I', '-c', SCRIPT, file], { timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Raw markdown is cached by content hash when TYPHOON_CACHE_DIR is set; API errors retry with backoff. */
export async function typhoonText(buf: Buffer, mime: string, attempts = 3): Promise<string> {
  const cacheDir = process.env.TYPHOON_CACHE_DIR;
  const cached = cacheDir && path.join(cacheDir, createHash('sha256').update(buf).digest('hex') + '.md');
  if (cached && existsSync(cached)) return markdownToText(readFileSync(cached, 'utf8'));
  for (let i = 1; ; i++) {
    try {
      const md = await ocrOnce(buf, mime);
      if (cached) { mkdirSync(cacheDir, { recursive: true }); writeFileSync(cached, md); }
      return markdownToText(md);
    } catch (e) {
      if (i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 5000 * 2 ** (i - 1)));
    }
  }
}
