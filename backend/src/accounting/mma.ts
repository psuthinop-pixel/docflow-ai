// Bookkeeping, Phase D: the monthly management account (MMA) pack. Built from the month's journal (the books),
// so every figure traces back to journal lines. Pure functions; the routes fetch the inputs.
// Revenue is not captured yet (Phase E), so the P&L section is a cost statement. See docs/ACCOUNTING.md.
import type { JournalEntry } from './journal.js';
import { round2 } from './journal.js';

export interface AccountInfo { code: string; name: string; role: string; type: string }

export interface PackInput {
  organization: { id: string; name: string };
  month: string;
  period: { status: string; closed_at: string | null; closed_by: string | null };
  ready: boolean;
  blockers: { code: string; message: string; count: number }[];
  warnings: { code: string; message: string; count: number }[];
  entries: JournalEntry[];
  prevEntries: JournalEntry[];
  lyEntries: JournalEntry[];
  accounts: Map<string, AccountInfo>;
  advancesOutstanding: { paid_by: string; count: number; total: number; oldest_month: string }[];
  vatNotClaimable: { reason: string; count: number; vat: number }[];
  capexYtd: { category: string; amount: number }[];
}

export interface Pack {
  organizations: { id: string; name: string; status: string }[];
  month: string;
  status: 'closed' | 'provisional';
  closed_at: string | null;
  closed_by: string | null;
  checklist: { ready: boolean; blockers: PackInput['blockers']; warnings: PackInput['warnings'] };
  revenue: null;
  summary: {
    opex: number; opex_prev: number; opex_ly: number; opex_change_pct: number | null; opex_yoy_pct: number | null;
    capex: number; capex_ytd: number; input_vat: number; pp36_vat: number; vat_not_claimable: number;
    advances_opened: number; advances_repaid: number; advances_outstanding: number; cash_out: number; entries: number;
  };
  opex: { code: string; name: string; amount: number; prev: number; ly: number; change_pct: number | null; share_pct: number }[];
  top_vendors: { vendor: string; amount: number; count: number }[];
  capex: { items: { date: string; vendor: string; code: string; name: string; amount: number; property?: string }[]; ytd: { category: string; amount: number }[] };
  advances: { outstanding: { paid_by: string; count: number; total: number; oldest_month: string; property?: string }[] };
  vat: { not_claimable: { reason: string; count: number; vat: number }[] };
  cash: { weeks: { week: string; opex: number; capex: number; reimbursements: number; total: number }[] };
  by_property?: { id: string; name: string; status: string; opex: number; capex: number; input_vat: number; advances_outstanding: number; cash_out: number }[];
}

/** One decimal, halves rounded away from zero (−23.25% → −23.3%). */
const round1 = (n: number) => (Math.sign(n) * Math.round(Math.abs(n) * 10 + Number.EPSILON)) / 10;
const pct = (now: number, before: number) => (before ? round1(((now - before) / before) * 100) : null);

/** Account info for a code; a code missing from today's chart (renamed since a snapshot) is classed by its first digit. */
function info(accounts: Map<string, AccountInfo>, code: string, name: string): AccountInfo {
  return accounts.get(code) ?? { code, name, role: '', type: /^[56]/.test(code) ? 'expense' : /^1/.test(code) ? 'asset' : /^2/.test(code) ? 'liability' : 'other' };
}

const isCapexRole = (role: string) => role === 'fixed_asset' || role === 'construction';

/** Net debit per expense account. */
function opexByAccount(entries: JournalEntry[], accounts: Map<string, AccountInfo>) {
  const out = new Map<string, { code: string; name: string; amount: number }>();
  for (const e of entries) {
    for (const l of e.lines) {
      const a = info(accounts, l.account_code, l.account_name);
      if (a.type !== 'expense') continue;
      const row = out.get(l.account_code) ?? { code: l.account_code, name: l.account_name, amount: 0 };
      row.amount = round2(row.amount + l.debit - l.credit);
      out.set(l.account_code, row);
    }
  }
  return out;
}

const WEEKS = ['1-7', '8-14', '15-21', '22-end'];
const weekOf = (date: string) => WEEKS[Math.min(3, Math.floor((Number(date.slice(8, 10)) - 1) / 7))];

export function buildPack(i: PackInput): Pack {
  const opex = opexByAccount(i.entries, i.accounts);
  const prev = opexByAccount(i.prevEntries, i.accounts);
  const ly = opexByAccount(i.lyEntries, i.accounts);
  const sum = (m: Map<string, { amount: number }>) => round2([...m.values()].reduce((t, x) => t + x.amount, 0));
  const opexTotal = sum(opex);

  let capex = 0, inputVat = 0, pp36 = 0, opened = 0, repaid = 0;
  const capexItems: Pack['capex']['items'] = [];
  const vendors = new Map<string, { vendor: string; amount: number; count: number }>();
  const weeks = new Map(WEEKS.map((w) => [w, { week: w, opex: 0, capex: 0, reimbursements: 0, total: 0 }]));

  for (const e of i.entries) {
    let entryCapex = 0, entryCost = 0, bankOut = 0;
    for (const l of e.lines) {
      const a = info(i.accounts, l.account_code, l.account_name);
      if (isCapexRole(a.role) && e.kind === 'expense') {
        entryCapex = round2(entryCapex + l.debit);
        capexItems.push({ date: e.date, vendor: e.vendor_name, code: l.account_code, name: l.account_name, amount: l.debit });
      }
      if (a.type === 'expense') entryCost = round2(entryCost + l.debit - l.credit);
      if (a.role === 'input_vat') inputVat = round2(inputVat + l.debit);
      if (a.role === 'pp36_payable') pp36 = round2(pp36 + l.credit);
      if (a.role === 'advances_payable') {
        opened = round2(opened + l.credit);
        repaid = round2(repaid + l.debit);
      }
      if (a.role === 'bank' || a.role === 'cash') bankOut = round2(bankOut + l.credit - l.debit);
    }
    capex = round2(capex + entryCapex);
    if (e.kind === 'expense' && (entryCost || entryCapex)) {
      const key = e.vendor_name.trim() || '(no vendor)';
      const v = vendors.get(key) ?? { vendor: key, amount: 0, count: 0 };
      v.amount = round2(v.amount + entryCost + entryCapex);
      v.count += 1;
      vendors.set(key, v);
    }
    if (bankOut) {
      const w = weeks.get(weekOf(e.date))!;
      const bucket = e.kind === 'reimbursement' ? 'reimbursements' : entryCapex ? 'capex' : 'opex';
      w[bucket] = round2(w[bucket] + bankOut);
      w.total = round2(w.total + bankOut);
    }
  }

  const outstanding = round2(i.advancesOutstanding.reduce((t, x) => t + x.total, 0));
  const cashOut = round2([...weeks.values()].reduce((t, w) => t + w.total, 0));
  return {
    organizations: [{ ...i.organization, status: i.period.status === 'closed' ? 'closed' : 'provisional' }],
    month: i.month,
    status: i.period.status === 'closed' ? 'closed' : 'provisional',
    closed_at: i.period.closed_at,
    closed_by: i.period.closed_by,
    checklist: { ready: i.ready, blockers: i.blockers, warnings: i.warnings },
    revenue: null,
    summary: {
      opex: opexTotal, opex_prev: sum(prev), opex_ly: sum(ly),
      opex_change_pct: pct(opexTotal, sum(prev)), opex_yoy_pct: pct(opexTotal, sum(ly)),
      capex, capex_ytd: round2(i.capexYtd.reduce((t, x) => t + x.amount, 0)),
      input_vat: inputVat, pp36_vat: pp36, vat_not_claimable: round2(i.vatNotClaimable.reduce((t, x) => t + x.vat, 0)),
      advances_opened: opened, advances_repaid: repaid, advances_outstanding: outstanding, cash_out: cashOut, entries: i.entries.length,
    },
    opex: [...new Set([...opex.keys(), ...prev.keys()])].map((code) => {
      const now = opex.get(code)?.amount ?? 0;
      const before = prev.get(code)?.amount ?? 0;
      return {
        code, name: (opex.get(code) ?? prev.get(code))!.name, amount: now, prev: before, ly: ly.get(code)?.amount ?? 0,
        change_pct: pct(now, before), share_pct: opexTotal ? round1((now / opexTotal) * 100) : 0,
      };
    }).sort((a, b) => b.amount - a.amount || a.code.localeCompare(b.code)),
    top_vendors: [...vendors.values()].sort((a, b) => b.amount - a.amount).slice(0, 10),
    capex: { items: capexItems, ytd: i.capexYtd },
    advances: { outstanding: i.advancesOutstanding },
    vat: { not_claimable: i.vatNotClaimable },
    cash: { weeks: [...weeks.values()] },
  };
}

/** Group pack: sums across properties; each property's own figures kept in by_property. */
export function consolidate(packs: Pack[], month: string): Pack {
  const s = (f: (p: Pack) => number) => round2(packs.reduce((t, p) => t + f(p), 0));
  const opex = new Map<string, Pack['opex'][number]>();
  for (const p of packs) {
    for (const o of p.opex) {
      const row = opex.get(o.code) ?? { ...o, amount: 0, prev: 0, ly: 0, change_pct: null, share_pct: 0 };
      row.amount = round2(row.amount + o.amount);
      row.prev = round2(row.prev + o.prev);
      row.ly = round2(row.ly + o.ly);
      opex.set(o.code, row);
    }
  }
  const opexTotal = s((p) => p.summary.opex);
  const prevTotal = s((p) => p.summary.opex_prev);
  const lyTotal = s((p) => p.summary.opex_ly);
  const vendors = new Map<string, Pack['top_vendors'][number]>();
  for (const v of packs.flatMap((p) => p.top_vendors)) {
    const row = vendors.get(v.vendor) ?? { vendor: v.vendor, amount: 0, count: 0 };
    row.amount = round2(row.amount + v.amount);
    row.count += v.count;
    vendors.set(v.vendor, row);
  }
  const reasons = new Map<string, Pack['vat']['not_claimable'][number]>();
  for (const v of packs.flatMap((p) => p.vat.not_claimable)) {
    const row = reasons.get(v.reason) ?? { reason: v.reason, count: 0, vat: 0 };
    row.count += v.count;
    row.vat = round2(row.vat + v.vat);
    reasons.set(v.reason, row);
  }
  const ytd = new Map<string, number>();
  for (const y of packs.flatMap((p) => p.capex.ytd)) ytd.set(y.category, round2((ytd.get(y.category) ?? 0) + y.amount));
  const allClosed = packs.length > 0 && packs.every((p) => p.status === 'closed');
  return {
    organizations: packs.flatMap((p) => p.organizations),
    month,
    status: allClosed ? 'closed' : 'provisional',
    closed_at: null,
    closed_by: null,
    checklist: {
      ready: packs.every((p) => p.checklist.ready),
      blockers: packs.flatMap((p) => p.checklist.blockers.map((b) => ({ ...b, message: `${p.organizations[0].name}: ${b.message}` }))),
      warnings: packs.flatMap((p) => p.checklist.warnings.map((b) => ({ ...b, message: `${p.organizations[0].name}: ${b.message}` }))),
    },
    revenue: null,
    summary: {
      opex: opexTotal, opex_prev: prevTotal, opex_ly: lyTotal, opex_change_pct: pct(opexTotal, prevTotal), opex_yoy_pct: pct(opexTotal, lyTotal),
      capex: s((p) => p.summary.capex), capex_ytd: s((p) => p.summary.capex_ytd), input_vat: s((p) => p.summary.input_vat),
      pp36_vat: s((p) => p.summary.pp36_vat), vat_not_claimable: s((p) => p.summary.vat_not_claimable),
      advances_opened: s((p) => p.summary.advances_opened), advances_repaid: s((p) => p.summary.advances_repaid),
      advances_outstanding: s((p) => p.summary.advances_outstanding), cash_out: s((p) => p.summary.cash_out), entries: s((p) => p.summary.entries),
    },
    opex: [...opex.values()].map((o) => ({ ...o, change_pct: pct(o.amount, o.prev), share_pct: opexTotal ? round1((o.amount / opexTotal) * 100) : 0 }))
      .sort((a, b) => b.amount - a.amount || a.code.localeCompare(b.code)),
    top_vendors: [...vendors.values()].sort((a, b) => b.amount - a.amount).slice(0, 10),
    capex: {
      items: packs.flatMap((p) => p.capex.items.map((x) => ({ ...x, property: p.organizations[0].name }))),
      ytd: [...ytd.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    },
    advances: { outstanding: packs.flatMap((p) => p.advances.outstanding.map((x) => ({ ...x, property: p.organizations[0].name }))) },
    vat: { not_claimable: [...reasons.values()] },
    cash: {
      weeks: WEEKS.map((week) => {
        const ws = packs.map((p) => p.cash.weeks.find((w) => w.week === week)!);
        const f = (k: 'opex' | 'capex' | 'reimbursements' | 'total') => round2(ws.reduce((t, w) => t + w[k], 0));
        return { week, opex: f('opex'), capex: f('capex'), reimbursements: f('reimbursements'), total: f('total') };
      }),
    },
    by_property: packs.map((p) => ({
      id: p.organizations[0].id, name: p.organizations[0].name, status: p.status, opex: p.summary.opex, capex: p.summary.capex,
      input_vat: p.summary.input_vat, advances_outstanding: p.summary.advances_outstanding, cash_out: p.summary.cash_out,
    })),
  };
}
