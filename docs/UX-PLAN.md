# DocFlow AI — UX/UI Improvement Plan

Review date: 2026-10-30. Scope: the static frontend (`index.html`, `app.js`, `pages/*.js`, `style.css`).

## Summary

- The **receipt capture loop** (upload → review → save → approve) is the product, and it works. But the review screen doesn't show the receipt image, so every check needs a second window.
- **Trust problem:** about half the app is mock data shown as if it were live: Email, LINE, Drive, Reports, Sheets sync, the "Integrations: Active" card and the sidebar badge. Users will act on numbers that aren't real.
- **The dashboard reports wrong numbers:** "Pending Review" counts a `pending` status that the backend doesn't have (it uses `draft`), so it always shows 0. The Status column always says "confirmed", Source always says "upload", and "MTD" is really all-time.
- **Mobile is broken:** `navigate()` sets the sidebar and grid with inline styles, which override the `@media` rules. On a phone, the device people photograph receipts with, the layout squeezes.
- **Thai SME users get an English-only UI**, with Western date formats and no พ.ศ.

## P0 — Fix what's wrong (≈1 week)

| # | Issue | Where | Fix |
|---|---|---|---|
| 1 | "Pending Review" is always 0 | `pages/dashboard.js` | Count `draft` (plus `confirmed` waiting for approval, for approvers) |
| 2 | Status and Source columns are hardcoded | `pages/dashboard.js` | Show `e.status` and the real source |
| 3 | "MTD" total is all-time | `pages/dashboard.js` | Filter to the current month, or rename the label |
| 4 | Engine label shows "Tesseract" when Typhoon did the extraction | `pages/receipts.js` `renderOcrResult` | Map `typhoon` / `claude` / `tesseract` |
| 5 | VAT on Sheets = total × 7% | `pages/sheets.js` | Sum the real `tax_amount` |
| 6 | Sidebar badge and Sheets categories come from `MockData` | `app.js`, `pages/sheets.js` | Use the real expenses and the organization's categories |
| 7 | Vendor names, org names and the user name go into HTML unescaped (stored XSS through OCR text) | `dashboard.js`, `select-organization.js`, `app.js` | Use the existing `esc()` everywhere; move it to a shared util |
| 8 | Null dates show "Invalid Date" | dashboard, receipts tables | Show `—` |
| 9 | Mobile layout broken | `app.js` `navigate()` | Toggle a class on `body` instead of inline styles; add a bottom tab bar under 680px |
| 10 | Mock pages look live | Email, LINE, Drive, Reports, Integrations card | Add a "Preview — not connected" banner, or hide them behind a flag until Phase 2–3 |

## P1 — Make receipt review fast (1–2 weeks), where most of the value is

1. **Side-by-side review:** the receipt image (zoom, rotate) on the left, the fields on the right. The `fileUrl()` endpoint already serves the image.
2. **One-step upload:** start extraction when a file is dropped. Drop the separate "Run AI OCR" click.
3. **Batch upload + review queue:** drop 20 receipts, then step through them with "Save & next" (keyboard: Enter / ⌘S / J/K).
4. **Field-level flags:** put the warnings next to the field they're about (red border on the tax ID when its checksum fails, amber on VAT ≠ 7%) instead of in one block of text at the top.
5. **In-app duplicate dialog:** replace the native `confirm()` with a side-by-side comparison against the existing record.
6. **Approvals inbox:** a "To approve" filter with bulk approve for owner/admin users.
7. **Stable row IDs:** Edit and Approve currently use the array index, so they can hit the wrong row after a reload. Use the expense ID.
8. **Move "Disable expense"** out of the save form into a row action, with an undo toast.
9. **Mobile capture:** `<input capture="environment">` so people can shoot receipts directly; big tap targets.

## P2 — Information architecture & localisation (1–2 weeks)

- **Hash routing** (`#/receipts`, `#/expenses/:id`), so refresh, the back button and shared links work.
- **Merge "Receipts" and "Sheets"** into one **Expenses** list (filters, search, date range, status tabs: Draft · Confirmed · Approved). Sheets becomes an export/sync setting.
- **Group the nav by job, not by technology:** Capture (Upload, LINE, Email) · Review · Expenses · Reports · Settings.
- **Thai/English toggle (i18n)**, พ.ศ. date display option, ฿ formatting with 2 decimals.
- **Empty, loading and error states:** skeletons instead of an emoji spinner, and every list shows an actionable empty state.
- **Organization switcher:** a searchable dropdown with role and colour, instead of a `<select>` that has "Manage" mixed into the options.

## P3 — Visual system & accessibility (ongoing, runs alongside P1–P2)

- **Design tokens + components:** there are ~237 inline `style=""` attributes across the pages. Move them into classes (`.alert`, `.field`, `.stack`, `.empty-state`).
- **Icons:** replace the emoji with one SVG icon set (e.g. Lucide). The emoji render differently on each OS and look less professional.
- **Visual direction:** a calmer, warm-neutral light theme as the default for office use (ivory surfaces, one accent colour, tabular numerals for amounts), with dark as an option.
- **Accessibility:** nav items are `<div onclick>`, so they can't be reached by keyboard. Make them `<a>`/`<button>`, label the form fields, add visible focus rings and `aria-live` toasts, and check colour contrast on the badges.
- **Dashboard rethink:** an action-first layout ("5 drafts to review", "3 awaiting approval", "2 possible duplicates") above the vanity KPIs, plus a month-over-month spend chart once the Phase 2 summary endpoints exist.

## Sequencing & dependencies

```
Week 1      P0 fixes (bugs, trust banners, mobile shell)
Week 2–3    P1 review workspace + batch queue      ← biggest time saved per receipt
Week 4–5    P2 routing, Expenses merge, Thai i18n
Ongoing     P3 tokens/icons/a11y, done page by page as each is touched
Blocked     Reports redesign → needs ROADMAP Phase 2 summary endpoints
            LINE/Email UI   → needs ROADMAP Phase 3 integrations
```

## Success metrics

- Median time from upload to saved receipt (target: < 30 s per receipt in a batch)
- % of receipts saved without editing a field (a proxy for OCR quality plus UI clarity)
- Mobile share of uploads
- Zero mock numbers visible on screens that look live
