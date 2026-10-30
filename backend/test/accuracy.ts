// Field accuracy over test/fixtures: npx tsx test/accuracy.ts [engine]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractReceipt } from '../src/extract/index.js';
import { shutdownOcr } from '../src/extract/ocr.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const expected = JSON.parse(readFileSync(path.join(dir, 'expected.json'), 'utf8')) as Record<string, Record<string, unknown>>;

export async function measure(engine = 'tesseract') {
  let hit = 0, total = 0;
  const misses: string[] = [];
  for (const [file, want] of Object.entries(expected)) {
    const mime = file.endsWith('.pdf') ? 'application/pdf' : file.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
    const { fields } = await extractReceipt(readFileSync(path.join(dir, file)), mime, [], engine);
    for (const [k, v] of Object.entries(want)) {
      total++;
      const got = (fields as unknown as Record<string, unknown>)[k];
      if (got === v) hit++;
      else misses.push(`${file} ${k}: want ${JSON.stringify(v)} got ${JSON.stringify(got)}`);
    }
  }
  return { accuracy: hit / total, hit, total, misses };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await measure(process.argv[2]);
  console.log(`accuracy ${(r.accuracy * 100).toFixed(1)}% (${r.hit}/${r.total})`);
  r.misses.forEach((m) => console.log('  miss', m));
  await shutdownOcr();
}
