# Dirty Graphix workflow app: design rules

The look of this app is already decided. The approved mockups in `design/screens/` are the target, and `design/tokens.css` holds every value. Build to match them exactly. When something isn't covered here, copy the closest existing pattern instead of inventing a new one.

## Rules for Claude Code

1. Use `tokens.css` for every color, font, radius, shadow and size. Never hard-code a hex value in a component.
2. Don't add a UI library theme (Material, Bootstrap, default shadcn colors and so on). If a component library is used for behavior, restyle it fully with these tokens.
3. Before calling a screen done, screenshot it at 1440 px wide and compare it side by side with its mockup in `design/screens/`. Fix any differences in color, spacing, type size or order.
4. Keep the finish colors identical everywhere they appear. They match the colored folders in the shop.
5. Don't add icons, gradients, emoji or decorative illustrations. The only icon is the notification bell.
6. Prices never appear outside the billing screen.

## Two themes

| Theme | Used on | Background | Panels |
|---|---|---|---|
| Office (light) | Design queue, team lead, billing, new kits | `--bg` #F4F5F7 | white, 1px `--border` |
| Shop (dark) | Production queue TV, production backlog, receive material | `--shop-bg` #0F1113 | `--shop-surface` #181B1F |

Every screen in both themes starts with the same header bar: near-black `--header-bg`, a 4px orange bottom rule, "DIRTY GRAPHIX" in small orange tracked caps, then the screen title in 38px Barlow Condensed caps. "Signed in as **Name** · date", header buttons and the notification bell sit on the right.

The shop TV keeps its own oversized header and type because it's read from across the room.

## Type

- **Barlow Condensed, 600/700, uppercase:** screen titles (38px), section and group headings (18–22px, letter-spacing .04–.06em), stat numbers (34px), big lengths (26px), primary buttons (20px), roll numbers.
- **Inter, 400–700:** everything else. Body 15px, card text 15–16px, meta lines 13px, small caps labels 12–13px with .08em tracking.
- Numbers that line up in columns use `font-variant-numeric: tabular-nums`.

## Color meaning

Color always means one thing. Never reuse a meaning color for decoration.

**Finishes** (chips, card bands, roll bars): GL Gloss green #34C759 · MT Matte blue #3B82F6 · GG Gravel Guard purple #B57BFF · CG Chrome Gloss neon yellow #E6FF2E · PR Prismatic pink #FF3DA0 · CM Chrome Matte teal #14B8A6 · CP Chrome Prismatic gray #9AA3AE. Materials: WH white #F2F2F0, CR chrome #C9CED4. Text on any chip is #141414. Chips read "CODE · Name", for example `GL · Gloss`. A finish change shows as two chips with an arrow: `MT · Matte → CM · Chrome Matte`.

**Stages** (group dot, count pill, 6px left edge of each card): reprint red #D93636 · needs first proof blue #1F6FD1 · revision orange #E07B00 · waiting (customer or billing) gray #8A94A0 · approved/print file green #17803D · rush orange #FF8A1F.

**Kit phases:** Phase 1 Template slate #5B6B7A · Phase 2 Artwork blue #1F6FD1 · TY check orange #FF8A1F · Phase 3 Shopify listing green #17803D.

**Brand orange #FF8A1F** marks the header rule, the personal score card, the to-do count, the bell badge, "You" owner pills and the main call to action on dark screens. Orange text on light backgrounds uses #A84C05.

**Shop TV status:** Ready batches are red #FF4545, rush is orange, holding is a gray outline.

## Components

Recipes are in `tokens.css`. Match these exactly.

- **Stat card:** white card with a 5px colored top edge, small gray label, 34px Barlow number, small gray note. Four across on office screens.
- **Group header:** 12px rounded-square dot in the group color, caps title, count pill pushed to the right in the same color.
- **Queue card:** white, 12px radius, 6px left edge in its group color. Order number bold, machine on the next line, finish chips, then a 13px meta line (orange #A84C05 when it needs attention). The selected card gets a 2px near-black border and a soft shadow.
- **Detail panel:** white, 14px radius, 24px padding, optional 6px colored top edge.
- **Machine card / hand-off row:** 8px band in the machine's finish color (top on cards, left on rows) plus its finish chip.
- **Actions menu:** one dark "Order actions ▾" button. It opens a light inset panel with three labeled groups: Ask the customer (blue), Customer told you directly (green approve, red reject), Flag this order (orange). Rarely used actions never sit on the main screen.
- **Checklist steps:** 22px rounded box filled with the phase color when done, step text, owner pill (gray; orange "You" for the signed-in person), and a meta line "Done · date" or "To do".
- **Milestone banner:** a light card with a large circle that fills green with a check when the milestone is met. Shows what it unlocks and what's still needed.
- **Your to-dos:** a dark (#16181B) card at the top of the left column with an orange count, dark rows, small colored type tags (KIT STEP slate, QUESTION blue).
- **Notification bell:** outlined header button with an orange unread badge. It opens a white popover (14px radius, popover shadow) with a colored dot per item and unread rows tinted #FFF8EF.
- **Buttons:** 44px minimum height (48px for primary). Primary office action is blue with Barlow caps, gray when disabled. The main call to action on shop screens is full-width orange Barlow caps.
- **Progress bar:** 8px track in #EEF0F3, fill in the phase or finish color.
- **Roll bar (shop):** dark track, segments in the finish color, hatched for "coming from design", thin white roll-break markers, dashed white cut-section marker.

## Layout

- Max width 1440px, 24px side gutters, 20px gaps.
- Office screens: header, stat row, then a left queue column (about 360px) and a detail panel that fills the rest.
- Cards and panels wrap to one column on narrow screens. Nothing scrolls sideways.
- Secondary details (contact info, shipping, rarely used actions) start collapsed behind a text link or menu.

## Screens

| File | Screen | Theme |
|---|---|---|
| `screens/01-designer-queue.png` | Design queue (to-dos, bell, queue, order panel, hand-off) | Office |
| `screens/01b-notifications.png` | Bell popover | Office |
| `screens/02-team-lead.png` | Daily assignment | Office |
| `screens/03-billing.png` | Billing changes (Nikki) | Office |
| `screens/04-new-kits.png` | New kits (kit development) | Office |
| `screens/05-production-queue-tv.png` | Production queue (shop TV) | Shop |
| `screens/06-production-backlog.png` | Production backlog | Shop |
| `screens/07-receive-material.png` | Receive material | Shop |
| `screens/08-office-tv.png` | Office TV team score | Shop |
| `screens/09-proof-page.png` | Customer proof page (phone) | Shop |
| `screens/10-labels.png` | Thermal labels and job ticket (black only) | Print |

## Add this to CLAUDE.md

```
## UI
All UI follows design/DESIGN.md and design/tokens.css. Every screen must match its mockup in design/screens/.
Never hard-code colors or fonts. After building or changing a screen, screenshot it at 1440px and compare it to the mockup before calling it done.
```
