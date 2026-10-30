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

## ✅ Done, batch 2: navigation, correctness, mobile

**Navigation**
- The sidebar has two groups: **Workspace** (Dashboard, Receipts) and **Coming soon** (Reports "Preview"; Email, LINE, Drive and Sheets "Soon"), with the mock pages dimmed.
- Every page still on sample data shows a 🚧 banner saying so. This covers Reports, Email, LINE, Drive and Settings; on Sheets the banner says the table is real but sync is not connected yet.
- Nav items are `<button>`s: keyboard focusable, with `aria-current` on the active page. The browser tab title follows the page.
- Sheets has its own icon (🗂️). Removed the topbar breadcrumb and the stale version stamp.
- **Property visibility:** the switcher is labelled "Property" and has a left strip in the property's colour. The dashboard H1 shows a matching dot, and the organization picker shows a colour strip on each card. Properties without a saved colour get a stable one derived from their id. The create form has a colour picker, which saves `color` through the existing API. Colours are validated as hex before use in `style`.

**Correctness**
- The OCR panel names the real engine (Typhoon / Tesseract / Claude).
- Receipts refetches on every visit and keeps the current rows on screen while the same property reloads.
- The draft badge refreshes when you switch property, from any page.
- Toast messages are escaped. The Sheets table (real data) and the organization picker escape their text and use the shared money and date formats. Sheets shows VAT instead of the raw organization id.
- Layout no longer sets the sidebar's `display` inline; it uses a body class, so the mobile CSS works.

**Mobile and theme**
- Below 680px: a ☰ button opens the sidebar as a drawer. It closes on backdrop tap, Esc or navigation. The property switcher takes the topbar width, tables scroll horizontally, and the empty "AI OCR Ready" panel is hidden.
- Light theme: the sidebar stays dark, so it now keeps light text (it was nearly invisible).
- Skeleton loaders on Dashboard and Receipts, and `prefers-reduced-motion` is respected.

## ✅ Done, batch 3: real Settings page
- Removed the fake OpenAI/Gmail/LINE/Google key fields, the "Test" buttons that always said "connected", "Save All", mock company management, the unused preferences and "Clear All Data".
- **Property** section: edit the name, colour and the category list used in receipt review. Owners and admins only; members see it read-only. Saved through the new `PUT /organizations/:id`, which validates hex colours and trims and de-duplicates categories. `POST /organizations` now validates colour and categories too.
- **Receipt reading (OCR)**: read-only status from the new authenticated `GET /system/status`: the engine in use, the mode, and which engines are configured. It reports whether keys are set, never the keys themselves. When Typhoon is off, it warns and names the Vercel env var to set.
- **Account** (name, email, role, sign out), **Appearance** (theme), and **Data**: a CSV export of every record for the property. The export has a UTF-8 BOM so Thai opens correctly in Excel, keeps the leading zero on tax IDs, and blocks formula injection from OCR'd text.
- **Integrations**: an honest "planned for Phase 3" list.
- Backend tests: org edit permissions and validation, and system status. 19/19 pass.

## Still open
- [ ] The mock pages (email, line, drive, reports) still put `MockData` into `innerHTML` unescaped. Fix this when each one is wired to real data.
- [ ] Members: there is no way to invite a user to a property or change roles. Needs membership endpoints and a Members section in Settings.
- [ ] Renaming or removing a category doesn't touch existing expenses that use it. Decide whether to offer "rename everywhere".
- [ ] Organization picker: currency shows "N/A" when the API omits it.
- [ ] Topbar on phones: the avatar and theme toggle take about a third of the width. Now that Settings has a theme switch, consider moving the toggle there.

## Phase 2 tie-in: move aggregation to the server
- [ ] The dashboard aggregates every expense in the browser. Fine at hundreds of rows, slow at thousands. Add `GET /expenses/summary?organization_id&month` (spend, prior month, counts by status, VAT, by category) and use it for the KPIs.
- [ ] Confirm the definitions with the accountant before relying on them for filing:
  - "Spend" = non-disabled records, any status including draft, by **receipt date** (not upload date).
  - "Input VAT" = confirmed/approved records with VAT > 0 **and** a 13-digit seller tax ID. Thai input VAT is claimable only on a full tax invoice, so also check `is_tax_invoice` once it is stored on the expense.
- [ ] Rebuild Reports on real data (it is still `MockData`). Until then, the dashboard and Reports will disagree.

## P2: polish
- [ ] Replace emoji icons with an SVG set (e.g. Lucide). Emoji render differently across OSes and in the LINE in-app browser.
- [ ] Light theme: check KPI accent colours and the badges for WCAG AA contrast.
- [ ] Mobile: consider card rows instead of horizontally scrolling tables for Receipts, the most-used page on a phone.

## How to check the dashboard locally
```
make run-dev        # static frontend on :3000
make run-backend    # API on :8000
```
Check these states at desktop width and at 390px, in both themes: an organization with no expenses (empty state), the API stopped (error card plus Retry), and a mix of draft/confirmed/approved/disabled records, both this month and last month.
