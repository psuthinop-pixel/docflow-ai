# Theme brief: "Mission Control" (FUI) dashboard

> Portable prompt for replicating DocFlow's Mission Control theme in another project.
> Source of truth: `style.css` (Mission Control section, `[data-theme="mission-control"]`).

Restyle the dashboard as a calm, flat FUI ("fictional user interface") control-room screen.
Think of an instrument panel, not a sci-fi movie prop. No glow, no gradients, no
rounded corners, no shadows.

## Scope
- Put every rule under `[data-theme="mission-control"]` on `<html>` so the existing theme isn't touched.
- Dark is the reference palette. `[data-mode="light"]` swaps only the tokens.
- Map the existing token names (accent, green, amber, red, radius-*, shadow-*) onto the
  new palette. Set every radius to 0px and every shadow, glow and gradient to none.

## Tokens: dark / light
| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#050607` | `#f3f4f1` | page |
| `--bg-grid` | `#0e1112` | `#e4e7e2` | background grid lines |
| `--surface` | `#0a0d0e` | `#fbfbf9` | panels |
| `--surface-hover` | `#11181a` | `#eaefeb` | row/hover |
| `--track` | `#151a1b` | `#e1e5e0` | progress tracks, skeletons, chart grid |
| `--line` | `#1c2224` | `#cdd3ce` | borders |
| `--line-soft` | `#121718` | `#e3e7e2` | row rules |
| `--text` | `#d7dcdb` | `#1f2624` | body |
| `--text-strong` | `#f2f4f3` | `#0a0d0c` | headings, values |
| `--text-muted` | `#8c9592` | `#545e5a` | labels |
| `--accent` | `#7fe3c4` | `#0b7357` | mint; the only "live/OK" colour |
| `--accent-ink` | `#04110d` | `#ffffff` | text on accent |
| `--accent-fill` | `rgba(127,227,196,.12)` | `rgba(11,115,87,.12)` | chart area |
| `--warn` | `#f2c46d` | `#8a5a00` | pending / error |
| `--warn-line` | `#5a4a24` | `#d8c08a` | warn borders |
| `--danger` | `#ff8a7a` | `#b3261e` | destructive |

Use one accent colour only. Success and info both use the accent; there is no separate green or blue.

## Typography
- Display: Space Grotesk 500, UPPERCASE, letter-spacing .06em (h1, logo, page title).
- Body: JetBrains Mono, 13px, letter-spacing .04em, tabular numbers.
- Section labels: 11px UPPERCASE muted, letter-spacing .1em, in the style `SPEND // OCT`.
  Use this for card titles, KPI labels and table headers.
- KPI value: mono 36px weight 300, text-strong. A live metric uses the accent colour.

## Surfaces
- Page: `--bg` with a faint 40px grid made of two 1px linear-gradients in `--bg-grid`.
- Panels, cards, modals: `--surface`, 1px solid `--line`, square corners. No hover lift and no backdrop blur.
- Optional ↗ link in a card's top-right corner (44px hit area, muted, accent on hover).

## Components
- **Nav:** the sidebar becomes a horizontal bar under the topbar. Items are 11px uppercase muted.
  The active item gets text-strong and a 2px accent bottom border.
- **Buttons:** 44px min height, square, 12px uppercase .08em.
  Primary: solid accent fill with accent-ink text. Secondary: 1px line border, transparent background.
- **Status:** a `● ` dot plus uppercase text. No pills or chip backgrounds.
  Accent = OK, warn = pending/error, muted = draft.
- **Filter tabs:** same style as the nav (2px accent underline when active).
- **Progress:** 4px flat track with an accent fill. Show counts as a segmented bar
  (6 blocks with 3px gaps; filled blocks in accent).
- **Charts:** 1px accent line (1.5 stroke), area fill in `--accent-fill`, grid lines in `--track`,
  axis labels 11px muted. No legends unless needed.
- **Activity feed** in terminal-log style: `TIME  VERB  message` rows separated by
  `--line-soft` rules, ending in a blinking accent `█` cursor (respect `prefers-reduced-motion`).
- **Banner:** 1px warn-line border with warn text and no fill.
- **Tables:** header has a 1px line underneath. Rows use line-soft rules and the surface-hover
  colour on hover. The first column is text-strong.
- **Inputs:** square, `--bg` background, 1px line border, mono font.
- **Icons:** 16px outline, muted colour, no icon tiles or backgrounds.

## Accessibility
- Focus: 1px accent outline with 2px offset on every element (`:focus-visible`).
- Touch targets ≥44px. Muted and accent text must reach ≥4.5:1 contrast in both modes.
- At ≤680px: hide the logo, use a single-column KPI grid, 16px page padding, and let
  wide tables scroll inside their panel.

## Feel
Quiet, precise, dense with data. Colour should signal state and never decorate.
If an element doesn't carry information, leave it out.

---
*Tailwind projects: expose the tokens as CSS variables and reference them in `tailwind.config` → `theme.extend.colors`.*
