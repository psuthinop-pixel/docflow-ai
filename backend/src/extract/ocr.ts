// Text extraction: PDF text layer (pdfjs), scanned PDF → images (pdftoppm), images → Tesseract (tha+eng).
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWorker, type Worker } from 'tesseract.js';

const require = createRequire(import.meta.url);
const run = promisify(execFile);

export interface OcrText { text: string; confidence: number; source: 'pdf-text' | 'tesseract' }

/** tesseract.js wants every language in one directory; the npm data packages ship one each. */
function tessdataDir(): string {
  const dir = path.join(tmpdir(), 'docflow-tessdata');
  mkdirSync(dir, { recursive: true });
  for (const lang of ['tha', 'eng']) {
    const target = path.join(dir, `${lang}.traineddata.gz`);
    if (existsSync(target)) continue;
    const pkg = path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
    copyFileSync(path.join(pkg, '4.0.0_best_int', `${lang}.traineddata.gz`), target);
  }
  return dir;
}

let workerPromise: Promise<Worker> | null = null;
function getWorker(): Promise<Worker> {
  workerPromise ??= createWorker('tha+eng', 1, { langPath: tessdataDir(), gzip: true, cachePath: tessdataDir() });
  return workerPromise;
}

export async function shutdownOcr(): Promise<void> {
  if (workerPromise) await (await workerPromise).terminate();
  workerPromise = null;
}

export async function ocrImage(buf: Buffer): Promise<OcrText> {
  const worker = await getWorker();
  const { data } = await worker.recognize(buf);
  return { text: data.text, confidence: Math.round(data.confidence), source: 'tesseract' };
}

/** Text layer of a PDF, reconstructed line by line. Empty for scanned PDFs. */
export async function pdfText(buf: Buffer, maxPages = 3): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Preload the worker under a literal path so serverless bundlers (Vercel's file tracing) ship it;
  // pdfjs otherwise resolves it at runtime and fails with "Setting up fake worker failed".
  // @ts-expect-error -- pdfjs-dist ships no types for the worker entry.
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker ??= await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true });
  const doc = await task.promise;
  const out: string[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] / 3) * 3;
      (rows.get(y) ?? rows.set(y, []).get(y)!).push({ x: item.transform[4], s: item.str });
    }
    [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .forEach(([, items]) => out.push(items.sort((a, b) => a.x - b.x).map((i) => i.s).join(' ')));
  }
  await task.destroy();
  return out.join('\n');
}

/** Rasterise the first pages of a scanned PDF (requires poppler's pdftoppm). */
async function pdfToImages(buf: Buffer, maxPages = 2): Promise<Buffer[]> {
  const dir = mkdtempSync(path.join(tmpdir(), 'docflow-pdf-'));
  try {
    const input = path.join(dir, 'in.pdf');
    await import('node:fs/promises').then((fs) => fs.writeFile(input, buf));
    // Grayscale: tesseract.js returns nothing for some colour PNGs from pdftoppm.
    await run('pdftoppm', ['-r', '300', '-png', '-gray', '-f', '1', '-l', String(maxPages), input, path.join(dir, 'page')]);
    return readdirSync(dir).filter((f) => f.endsWith('.png')).sort().map((f) => readFileSync(path.join(dir, f)));
  } catch (err) {
    throw Object.assign(new Error('Scanned PDF needs poppler (pdftoppm) installed on the server'), { status: 422, cause: err });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function extractText(buf: Buffer, mime: string): Promise<OcrText> {
  if (mime === 'application/pdf') {
    const text = await pdfText(buf);
    if (text.replace(/\s/g, '').length > 30) return { text, confidence: 100, source: 'pdf-text' };
    const pages = await pdfToImages(buf);
    const results = [];
    for (const page of pages) results.push(await ocrImage(page));
    return {
      text: results.map((r) => r.text).join('\n'),
      confidence: Math.round(results.reduce((s, r) => s + r.confidence, 0) / Math.max(results.length, 1)),
      source: 'tesseract',
    };
  }
  return ocrImage(buf);
}
