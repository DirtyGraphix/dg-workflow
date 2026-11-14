# dg-workflow

Internal design and production workflow app for Dirty Graphix, which sells vinyl wrap kits for heavy equipment. It takes Shopify orders through design (assignment, proofs, turnaround), hands each machine off to production with its print length, and batches prints onto rolls by finish to keep waste low. It never touches print files.

The owner is TY. He isn't a developer, so explain decisions in plain language and keep him in the loop on anything he'll have to do by hand (Shopify settings, Cloudflare setup, secrets).

## Source of truth

- `docs/workflow-spec.md` holds every business rule: clocks, priorities, roll planner logic, scoring, emails, edge cases, build phases. Read the relevant section before building a feature. If the code and the spec disagree, ask TY; don't guess.
- `design/DESIGN.md` and `design/tokens.css` define the look. `design/screens/` has the approved mockup for every screen.

## UI

All UI follows design/DESIGN.md and design/tokens.css. Every screen must match its mockup in design/screens/.
Never hard-code colors or fonts. After building or changing a screen, screenshot it at 1440px and compare it to the mockup before calling it done.
`design/mockups/*.dc.html` are the mockup sources. They're in a template format (`{{holes}}`, `<sc-for>`, `<sc-if>`), so use them as a markup and style reference, not as runnable code.

## Hard rules

- **Prices are confidential.** No price, order total or amount paid ever reaches the design or production screens, their APIs or their tickets. Only the billing screen (Nikki) and admins (TY) see money.
- **Business time.** Clocks count Monday to Friday, 8:00 AM to 4:30 PM Central. They skip six holidays (New Year's Day, Memorial Day, July 4, Labor Day, Thanksgiving, Christmas), taking the observed weekday off when one lands on a weekend. Customer-facing timelines use calendar days.
- **No silent pauses.** The only pauses are equipment malfunction (production), the print file deadline (designer, explanation required), out sick or vacation, waiting on customer, billing or kit development. Every pause logs who, when and why.
- **Lengths:** designers enter print length at ¼ scale. Production length is ×4. Each print's footprint on the roll is its length plus 3 in.
- **Shopify is the store of record** for orders, customers and products. This app keeps its own workflow state and logins; it doesn't use Shopify staff accounts (the store is on the Grow plan).

## People and roles

- Designers: Andrew, Alissa, Bekah. Cierra is team lead and also takes orders.
- Nikki assigns orders and handles billing. Tara builds Shopify listings for new kits.
- Cole (production) locates new machines and builds templates. Alex runs production.
- TY is the owner and admin. He approves and prices new kits.

## Stack (proposed, confirm with TY at the start of Phase 1)

Everything runs on Cloudflare, where Dirty Graphix already hosts the customizer's app proxy:
- Workers: the app and API, including the Shopify webhook endpoint
- D1: the database
- R2: photos and uploads
- Email Service: customer emails (proofs, reminders, replies), queued in the app's outbox first
- Cron Triggers: timed jobs (reminders, forced prints, morning summary, stalled orders)
- Durable Objects: live updates for the shop TV and queues
- TypeScript throughout

## Build phases

See "Build plan" in `docs/workflow-spec.md`. Phase 1 is Shopify orders into the design queue: logins, assignment, the designer screen, and the proof page that replaces Approve Pro. Each phase must be usable before the next one starts.

## Working in this repo

- Work on a branch and open a pull request. Don't push straight to `main`.
- Never commit secrets (Shopify tokens, API keys). Use Wrangler secrets.
