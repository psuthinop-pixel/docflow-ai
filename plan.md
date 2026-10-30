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

## ✅ Done, batch 4: Members
- **Members** section in Settings: everyone in the property, with role and email. Owners and admins can add people, change roles and remove members. Anyone can leave.
- Adding an email that already has an account adds that account directly. An unknown email gets a new account with a one-time temporary password (format `xxxx-xxxx-xxxx`), shown once with a "Copy message" button ready to paste into LINE. There is no email delivery yet.
- Rules, enforced on the server and mirrored in the UI:
  - Owners manage everyone.
  - Admins manage admins and members, but can't touch owners or grant owner.
  - Members can only leave.
  - A property always keeps at least one owner.
- **Change password** in Settings → Account, so invited people can replace the temporary password.
- New API: `GET/POST /organizations/:id/members`, `PUT/DELETE /organizations/:id/members/:userId`, `POST /auth/password`. Covered by tests (20/20 pass).
- Toasts no longer show two icons when the message starts with its own emoji.

## ✅ Done, batch 5: forced password change for invites
- Invited accounts are flagged `must_change_password`, and the temporary password expires after **7 days** (`TEMP_PASSWORD_DAYS` in `backend/src/auth.ts`).
- While the flag is set, the server returns `403 password_change_required` for everything except `/auth/me`, `/auth/password` and `/auth/logout`. The app shows a "Set your password" screen that can't be skipped, including after a reload.
- Signing in with an expired temporary password is refused with a clear message (`temporary_password_expired`).
- **A password change signs out every other session.** Tokens issued before `password_changed_at` are rejected, and the device that made the change gets a fresh token. The check reuses the existing revoked-token query, so it adds no extra database round trip.
- Members list shows "Invite pending · until <date>" or "Invite expired". Owners and admins get **🔑 New password**, which issues a fresh temporary password, but only while the invite is pending. Once someone has chosen their own password, nobody else can reset it.
- When the API reports a session has ended, the app sends the user to the login screen with "Your session ended", instead of showing error cards.
- The `npm run seed` password reset clears the invite flag and signs out old sessions.
- Tests: forced change, expiry, re-issue, other sessions signed out, no reset after setup. 21/21 pass.

## ✅ Done, batch 6: Phase 2 reporting
- `GET /reports/summary` gives totals by month, category and property for one property or **all** of the user's properties (up to 36 months). It also returns the current work queue and the VAT that can't be claimed yet, with the reason. `GET /reports/vat` lists one property-month for the accountant. Definitions live in one place: `backend/src/routes/reports.ts`.
- **Reports page:**
  - Choose this property or all properties, with presets: this month, 3, 6 or 12 months, this year, last year.
  - Four cards: spend vs the previous equal period, average per month, claimable VAT, needs attention.
  - Monthly column chart, stacked by property and coloured with each property's own colour, with a hover/focus tooltip and a table view.
  - Categories (top 7 + Other), an input VAT panel, and a property comparison table.
- **Exports:**
  - Summary CSV in long format, one row per month and property, so it pivots in Excel.
  - **Input VAT report** for a property-month: Thai/English headers, dd/mm/yyyy dates, tax IDs keep their leading zero, each row marked Claimable / Missing seller tax ID / Not reviewed, and a claimable total row.
  - **Print / PDF** with a print stylesheet: always light, monthly table included.
- Charts are HTML/CSS with no CDN dependency; the Chart.js script was removed.
- The **Dashboard** now uses the same endpoint, so Dashboard and Reports can't disagree. It fetches only 5 + 8 rows for its lists instead of every expense. The sidebar draft badge uses the summary too.
- On phones, summary cards show as a 2×2 grid.
- Tests: summary maths, VAT rules, scoping across properties, range validation, `limit`/`sort`. 22/22 pass.

## ✅ Done, batch 7: accountant's answers (Western year · branch · .xlsx)
- **Dates stay Western year** (dd/mm/yyyy), as the accountant asked.
- **Seller branch is captured.** It's stored as the Revenue Department code in `expenses.vendor_branch`: `00000` = สำนักงานใหญ่, `00012` = สาขาที่ 00012, empty = unknown.
  - The parser reads it from the seller block only, so the buyer's "สำนักงานใหญ่" is ignored. The Claude extractor returns it too.
  - Typhoon and Tesseract warn when a tax invoice has a tax ID but no branch.
  - The review form has a "Head office / branch" field that accepts `00012`, `สาขาที่ 12`, `สำนักงานใหญ่` or `Head office`; the API normalises them.
- **Excel exports** (server-side, `exceljs`):
  - `GET /reports/vat.xlsx`: input tax report (รายงานภาษีซื้อ). Thai/English headers, real date cells, tax IDs as text, a branch column, a highlighted cell where a claimable invoice has no branch, SUM totals, and a separate "not claimable yet" section. Frozen header and filter. Prints landscape on one page width.
  - `GET /reports/summary.xlsx`: sheets By month (a column per property, with totals), By category, Input VAT, and Data (long format for pivots).
  - The Reports page has **⬇ Excel** as the main button; CSV is still available. The CSV exports gained the branch column.
- `npm audit` reports 2 moderate advisories in `uuid` (pulled in by `exceljs`). They concern a uuid function that exceljs's export path doesn't call.
- Tests: branch parsing including the buyer-block trap, API validation, and both workbooks read back cell by cell. 23/23 pass.

## Still open
- [ ] "Is a full tax invoice" isn't stored on expenses yet (`is_tax_invoice` is only detected at OCR time). Store it and require it for "claimable".
- [ ] **Email delivery for invites** (Resend, SES or similar) instead of copy-paste. This would also allow a self-service "forgot password", which today needs `npm run seed` on the server.
- [ ] Adding someone reveals whether an email already has a DocFlow account. This is acceptable for a small team tool, but worth revisiting before outside users sign up.
- [ ] Last-owner check is not atomic: two owners demoting each other at the same moment could leave none. Unlikely at this team size.
- [ ] Removing a member doesn't end their current session. They lose access to the property's data immediately, but stay signed in to any other properties they belong to (which is correct).
- [ ] The mock pages (email, line, drive) still put `MockData` into `innerHTML` unescaped. Fix this when each one is wired to real data.
- [ ] Renaming or removing a category doesn't touch existing expenses that use it.
- [ ] Organization picker: currency shows "N/A" when the API omits it.
- [ ] Topbar on phones: consider moving the theme toggle into Settings only.

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
