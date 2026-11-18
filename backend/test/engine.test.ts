import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractReceipt, pickEngine } from '../src/extract/index.js';
import { shutdownOcr } from '../src/extract/ocr.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('auto prefers Claude, then Typhoon, then offline OCR; explicit settings win', () => {
  const saved = { t: process.env.TYPHOON_OCR_API_KEY, a: process.env.ANTHROPIC_API_KEY, at: process.env.ANTHROPIC_AUTH_TOKEN };
  try {
    process.env.TYPHOON_OCR_API_KEY = 'x';
    process.env.ANTHROPIC_API_KEY = 'x';
    assert.equal(pickEngine('auto'), 'claude');
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    assert.equal(pickEngine('auto'), 'typhoon');
    assert.equal(pickEngine('tesseract'), 'tesseract');
    delete process.env.TYPHOON_OCR_API_KEY;
    assert.equal(pickEngine('auto'), 'tesseract');
  } finally {
    for (const [k, v] of [['TYPHOON_OCR_API_KEY', saved.t], ['ANTHROPIC_API_KEY', saved.a], ['ANTHROPIC_AUTH_TOKEN', saved.at]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('auto falls back to offline OCR when Typhoon cannot run', { timeout: 120_000 }, async () => {
  const saved = { key: process.env.TYPHOON_OCR_API_KEY, path: process.env.PATH, cache: process.env.TYPHOON_CACHE_DIR, a: process.env.ANTHROPIC_API_KEY };
  delete process.env.ANTHROPIC_API_KEY;
  process.env.TYPHOON_OCR_API_KEY = 'x';
  process.env.PATH = '/nonexistent'; // python3 not found → Typhoon fails without touching the network
  delete process.env.TYPHOON_CACHE_DIR;
  try {
    const r = await extractReceipt(readFileSync(path.join(fixtures, 'thai-tax-invoice.pdf')), 'application/pdf', [], 'auto');
    assert.equal(r.engine, 'tesseract');
    assert.match(r.warnings[0], /Typhoon OCR unavailable/);
    assert.ok(r.fields.total);
  } finally {
    process.env.PATH = saved.path;
    if (saved.key) process.env.TYPHOON_OCR_API_KEY = saved.key; else delete process.env.TYPHOON_OCR_API_KEY;
    if (saved.cache) process.env.TYPHOON_CACHE_DIR = saved.cache;
    if (saved.a) process.env.ANTHROPIC_API_KEY = saved.a;
    await shutdownOcr();
  }
});
