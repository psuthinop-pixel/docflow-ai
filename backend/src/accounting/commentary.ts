// Owner commentary on the MMA pack, written by Claude from the pack's figures only.
// Guard: every number in the text must match a figure in the pack; sentences that don't are dropped.
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import type { Pack } from './mma.js';

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-opus-5-5';

export interface Commentary { headline: string; highlights: string[]; risks: string[]; actions: string[] }
export interface CommentaryResult extends Commentary { model: string; removed: string[]; generated_at: string }

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'highlights', 'risks', 'actions'],
  properties: {
    headline: { type: 'string', description: 'One sentence: the most important thing about this month' },
    highlights: { type: 'array', items: { type: 'string' }, description: '2-4 bullets on what moved and why it matters' },
    risks: { type: 'array', items: { type: 'string' }, description: '0-3 bullets on risks or anomalies worth checking' },
    actions: { type: 'array', items: { type: 'string' }, description: '1-3 concrete next steps for the owner' },
  },
} as const;

/** The pack's own figures, as the model sees them (no internal ids). */
export function facts(pack: Pack) {
  return {
    month: pack.month,
    status: pack.status,
    properties: pack.organizations.map((o) => o.name),
    revenue: pack.revenue ?? 'not captured yet: do not discuss revenue, profit or margins',
    summary: pack.summary,
    opex_by_account: pack.opex.slice(0, 15),
    top_vendors: pack.top_vendors,
    capex_items: pack.capex.items.slice(0, 15),
    capex_ytd_by_category: pack.capex.ytd,
    advances_outstanding: pack.advances.outstanding,
    vat_not_claimable: pack.vat.not_claimable,
    cash_out_by_week: pack.cash.weeks,
    checklist: pack.checklist,
    by_property: pack.by_property,
  };
}

export const packHash = (pack: Pack) => createHash('sha256').update(JSON.stringify(facts(pack))).digest('hex').slice(0, 32);

/** Every number that appears anywhere in the facts, plus the calendar numbers of the month. */
export function allowedNumbers(pack: Pack): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) out.push(Math.abs(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    else if (typeof v === 'string') (v.match(/\d+/g) ?? []).forEach((d) => out.push(Number(d)));
  };
  walk(facts(pack));
  return out;
}

/** Numbers in the text with no matching figure (rounding to the whole baht is allowed, nothing looser). */
export function unsupportedNumbers(text: string, allowed: number[]): string[] {
  const bad: string[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const raw = m[0].replace(/,(?=\d{3}\b)/g, '');
    const n = Number(raw.replace(/,$/, ''));
    if (!Number.isFinite(n) || n <= 10) continue; // small counts, weekdays, "3 receipts" are always fine
    if (!allowed.some((a) => Math.abs(a - n) <= 0.51)) bad.push(m[0]); // rounding to the whole baht / 0.1% only
  }
  return bad;
}

/** Drop sentences that carry an unsupported number; return what was dropped. */
export function enforce(c: Commentary, allowed: number[]): { commentary: Commentary; removed: string[] } {
  const removed: string[] = [];
  const keep = (s: string) => {
    if (unsupportedNumbers(s, allowed).length) { removed.push(s); return false; }
    return true;
  };
  const headline = keep(c.headline) ? c.headline : '';
  return {
    commentary: { headline, highlights: c.highlights.filter(keep), risks: c.risks.filter(keep), actions: c.actions.filter(keep) },
    removed,
  };
}

export const commentaryEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

let client: Anthropic | null = null;

async function ask(pack: Pack, language: 'en' | 'th', feedback?: string): Promise<Commentary> {
  client ??= new Anthropic();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system:
      'You write the owner commentary for a Thai hotel group\'s monthly management accounts. The reader is the owner-operator: ' +
      'concise, high signal, focused on cash timing, cost control, capex and things that need a decision. ' +
      'Use only the figures in the data. Quote figures exactly as given (you may round baht to whole numbers and add thousand separators). ' +
      'Do not calculate new totals, differences or ratios that are not in the data; percentages are provided where useful. ' +
      (pack.revenue
        ? 'Revenue and gross operating profit (GOP = revenue − operating costs, before depreciation) are in the data, with occupancy, ADR and RevPAR where rooms are set; use them. Depreciation is not booked yet, so do not call GOP net profit. '
        : 'Revenue is not captured yet, so never mention revenue, profit, margin or EBITDA. ') +
      'If the month is provisional, say so in the headline. ' +
      (language === 'th' ? 'Write in Thai; keep account names and vendor names as given.' : 'Write in English.'),
    messages: [{
      role: 'user',
      content: `Monthly pack data (JSON):\n${JSON.stringify(facts(pack))}` + (feedback ? `\n\n${feedback}` : ''),
    }],
  });
  if (!('content' in response)) throw new Error('Unexpected streaming response');
  if (response.stop_reason === 'refusal') throw new Error('The commentary request was declined by the model');
  const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  return JSON.parse(text) as Commentary;
}

export async function generateCommentary(pack: Pack, language: 'en' | 'th' = 'en'): Promise<CommentaryResult> {
  const allowed = allowedNumbers(pack);
  let draft = await ask(pack, language);
  const all = [draft.headline, ...draft.highlights, ...draft.risks, ...draft.actions].join('\n');
  const bad = unsupportedNumbers(all, allowed);
  if (bad.length) {
    // One retry naming the figures that aren't in the data, then drop whatever is still unsupported.
    draft = await ask(pack, language, `Your previous draft used figures that are not in the data: ${bad.join(', ')}. Rewrite using only figures from the data.`);
  }
  const { commentary, removed } = enforce(draft, allowed);
  return { ...commentary, removed, model: MODEL, generated_at: new Date().toISOString() };
}
