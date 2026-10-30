# DocFlow AI — UX/UI follow-up plan

From the dashboard UX review of 30 Oct 2026. Items are ordered by priority; each one says where the change lives.

## ✅ Done (branch `claude/eager-cannon-9btx2x`)

**P0: numbers and labels that were wrong**
- "Pending Review" counted a `pending` status that the backend never sets. It now counts `draft` ("Drafts to review").
- "Total Expenses (MTD)" was really the all-time total. It is now "Spend in <month>", filtered by receipt date, with % change vs last month.
- A failed load used to look like an empty account (฿0). The dashboard now shows an error card with a Retry button and no figures. The Receipts list does the same.
- The Recent Expenses table used to hardcode `confirmed` / `📤 upload`. It now shows the real status and source (Upload if there is a `receipt_id`, otherwise Manual).
- Every activity row used to say "OCR processed". Rows now show the real event (Draft saved / Confirmed / Approved) with its timestamp, newest first.
- Removed the fake "Live Sync" badge from the topbar.
- Removed the "AI OCR — Coming soon" row (Typhoon OCR is live).
- XSS: OCR'd vendor names, categories, organization names and user name/email are now HTML-escaped. `esc()` moved to `app.js` as a shared helper.
- The sidebar Receipts badge used to read from `MockData`. It now shows the real draft count.

**P1: dashboard hierarchy**
- New KPI set: Spend this month, Drafts to review, Awaiting approval, Input VAT this month (tax ID required, with a count of records missing one).
- KPI cards are buttons that open Receipts with a status filter applied. Receipts has filter chips: All / Drafts / Awaiting approval / Approved / Disabled.
- One primary CTA (Upload Receipt). Removed the "Scan Email" CTA (it opened a mock page) and the Quick Actions card.
- The Integrations card is now one line of text.
- Added a spend-by-category breakdown for the current month.
- The empty state now has an Upload button.
- Money is always shown with 2 decimals (฿1,250.50). Dates use the `DD MMM YYYY` format, parsed without a timezone shift.
- Renamed "OCR Receipt Reader" to "Receipts" in the nav, title and page header.

## Next: P1 navigation (about half a day)
- [ ] Tag Email / LINE / Drive / Sheets in the sidebar as **Soon** and grey them out, or hide them behind a flag until Phase 3. They still run on `MockData` (`index.html`, `pages/email.js`, `line.js`, `drive.js`, `sheets.js`).
- [ ] Give Google Sheets its own icon. It currently uses 📊, the same as Dashboard (`index.html`).
- [ ] Remove the topbar breadcrumb ("Dashboard / Overview") or make it say something the H1 doesn't (`app.js` `titles`).
- [ ] Make the property switcher more prominent: a distinct colour per organization (`org.color` is already supported by `updateCompanyDot`) and a coloured strip or label in the page header. Wrong-property posting is the costliest mistake.
- [ ] Remove the stale "v1.0 · Feb 2026" stamp, or generate it at build time (`index.html`).

## Next: correctness gaps found while implementing
- [ ] The Receipts page shows "Tesseract (Thai + English)" for every engine except Claude, including Typhoon (`pages/receipts.js` `renderOcrResult`). Show the real `engine`.
- [ ] Receipts only refetches when the organization changes. Data approved or uploaded elsewhere stays stale until a reload. Refetch on each visit, or after a short TTL (`ReceiptsPage.render`).
- [ ] The draft badge resets to 0 when switching organization while on a mock page, and refills only when Dashboard or Receipts loads. Fetch the count on switch (`app.js` switcher handler).
- [ ] The mock pages (email, line, drive, sheets, reports, settings) still put data into `innerHTML` without `esc()`. Low risk while the data is mock, but must be fixed before they go live.
- [ ] Toast messages are put into `innerHTML` (`App.showToast`). Some contain server error text, so escape them.

## Phase 2 tie-in: move aggregation to the server
- [ ] The dashboard aggregates every expense in the browser. Fine at hundreds of rows, slow at thousands. Add `GET /expenses/summary?organization_id&month` (spend, prior month, counts by status, VAT, by category) and use it for the KPIs.
- [ ] Confirm the definitions with the accountant before relying on them for filing:
  - "Spend" = non-disabled records, any status including draft, by **receipt date** (not upload date).
  - "Input VAT" = confirmed/approved records with VAT > 0 **and** a 13-digit seller tax ID. Thai input VAT is claimable only on a full tax invoice, so also check `is_tax_invoice` once it is stored on the expense.
- [ ] Rebuild Reports on real data (it is still `MockData`). Until then, the dashboard and Reports will disagree.

## P2: polish and accessibility
- [ ] Replace emoji icons with an SVG set (e.g. Lucide). Emoji render differently across OSes and in the LINE in-app browser.
- [ ] Make sidebar nav items `<a>`/`<button>` instead of `<div onclick>`, so they work with the keyboard (`index.html`).
- [ ] Use skeleton loaders instead of the "📊 Loading Dashboard..." flash on each organization switch.
- [ ] Light theme pass: check KPI accent colours, filter chips and the error card for contrast.
- [ ] Mobile pass (≤680px): KPI grid, tables (horizontal scroll or card rows), sidebar collapse.

## How to check the dashboard locally
```
make run-dev        # static frontend on :3000
make run-backend    # API on :8000
```
Check these states: an organization with no expenses (empty state), the API stopped (error card plus Retry), and a mix of draft/confirmed/approved/disabled records, both this month and last month.
