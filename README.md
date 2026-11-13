# dg-workflow

Design and production workflow app for Dirty Graphix. It runs on Cloudflare (Workers, D1) with a React front end.

- `docs/workflow-spec.md`: how the whole system works, with every rule and decision
- `design/`: the approved look (rules, tokens, mockup screenshots and mockup sources)
- `CLAUDE.md`: instructions Claude Code reads at the start of every session

## What's built (Phase 1: foundation)

- **Shopify order intake:** new orders arrive by webhook and become jobs, one machine per wrap line item, with kit, finish and customizer selections. Prices are never stored or shown.
- **Logins:** the app has its own accounts, not Shopify staff seats. TY adds people on the People screen.
- **Assignment:** Cierra, Nikki and TY see unassigned orders with a suggested designer (lightest load, skipping anyone marked out) and each designer's workload.
- **Design queue:** each designer's orders, grouped and sorted the way the spec describes, with the order panel, timeline, machine cards, manual approve and reject (for Approve Pro, phone, in-person and text approvals), mark rush, mark custom one-off, and pausing the print file deadline with a reason.
- **Hand-off:** design checklist sign-off, lengths at ¼ scale with the ×4 full size, the "are you sure" check at 15% over or under the usual length, and hand-off per machine or all together.
- **Manual jobs** for orders that didn't come through Shopify.
- **Business-hours clock:** Monday to Friday, 8:00 AM to 4:30 PM Central, skipping the six holidays.

Next up is Phase 2: the customer proof page that replaces Approve Pro, and the Klaviyo emails.

## Run it on a computer (for development)

You need Node.js 22.

```sh
npm install
cp .dev.vars.example .dev.vars
npm run dev          # builds the app and starts it at http://localhost:8787
npm run seed:dev     # in a second terminal: adds the team and sample orders
```

Sign in with `ty@dev.local` (or any team member's first name `@dev.local`) and the password `dirtygraphix-dev`.

`npm test` runs the automated tests. `npm run typecheck` checks the code for type errors.

## Going live (one-time setup on Cloudflare and Shopify)

These steps need TY's accounts. Claude can walk through each one.

1. **Create the database:** `npx wrangler d1 create dg-workflow`, then paste the `database_id` it prints into `wrangler.jsonc`.
2. **Set the secrets** (never put these in the code):
   - `npx wrangler secret put SETUP_TOKEN`: any long random phrase, used once to create TY's admin login.
   - `npx wrangler secret put SHOPIFY_WEBHOOK_SECRET`: from the Shopify app's settings (step 4).
3. **Deploy:** `npm run deploy`. Then open `/setup` on the live app and create the admin login with the setup token.
4. **Connect Shopify:** create a custom app for the store and subscribe these webhooks to `https://<app address>/webhooks/shopify`: `orders/create`, `orders/updated`, `orders/paid`, `orders/cancelled`.
5. **Add the team** on the People screen.
