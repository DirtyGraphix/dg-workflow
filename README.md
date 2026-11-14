# dg-workflow

Design and production workflow app for Dirty Graphix. It runs on Cloudflare (Workers, D1, R2) with a React front end.

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

## What's built (Phase 2: proof page, replacing Approve Pro)

- **Customer proof page** at `/proof/<link>` (or `dirtygraphix.com/apps/proof/<link>` once the app proxy is set up). Dark Dirty Graphix look from `design/screens/09-proof-page.png`. Customers approve (with a confirm step), ask for changes with photos or logo files, take back an approval within 30 minutes, download the approved design, and message their designer. An APPROVED or CHANGES REQUESTED stamp shows over the proof once they decide.
- **Sending proofs:** designers drag in the proof image on the order, pick which machines it covers (one sheet for all, or one per machine so the customer can approve them one at a time), add a note or a reply template, and send. Each proof shows when the customer opened it.
- **Conversation on the order:** customer changes and messages land on the order, flag it "CUSTOMER WROTE" in the queue, and designers answer from the order. Nothing lives in a personal inbox.
- **Reminders:** automatic while a proof waits (every 2 days, up to 4, never past 28 days, business hours only), plus "Send reminder" on the order.
- **Proof settings (TY):** the Approve Pro options that still apply: change window, revision history, downloads, uploads, comment rules, approval checklist, all page wording, reminders, each customer email on/off with editable wording and a preview, BCC, reply templates, and a log of recent emails.
- **Emails** queue in the app first, then go out through Klaviyo as a "DG Workflow Email" event once the Klaviyo key is set. Until then nothing is sent and the log shows them as waiting.

Next up is Phase 3: production (roll planner, production screen, receive material and labels).

## Run it on a computer (for development)

You need Node.js 22.

```sh
npm install
cp .dev.vars.example .dev.vars
npm run dev          # builds the app and starts it at http://localhost:8787
npm run seed:dev     # in a second terminal: adds the team and sample orders and proofs
```

Sign in with `ty@dev.local` (or any team member's first name `@dev.local`) and the password `dirtygraphix-dev`.

`npm test` runs the automated tests. `npm run typecheck` checks the code for type errors.

## Going live (one-time setup on Cloudflare and Shopify)

These steps need TY's accounts. Claude can walk through each one.

1. **Create the database:** `npx wrangler d1 create dg-workflow`, then paste the `database_id` it prints into `wrangler.jsonc`.
2. **Set the secrets** (never put these in the code):
   - `npx wrangler secret put SETUP_TOKEN`: any long random phrase, used once to create TY's admin login.
   - `npx wrangler secret put SHOPIFY_WEBHOOK_SECRET`: from the Shopify app's settings.
   - `npx wrangler secret put KLAVIYO_PRIVATE_KEY`: a Klaviyo private API key with Events write access (see the Klaviyo step). Leave it unset until the Klaviyo flow is ready; emails just wait.
3. **Create the file storage** for proofs and customer uploads: `npx wrangler r2 bucket create dg-workflow-proofs`. After the first deploy, fill in `APP_ORIGIN` in `wrangler.jsonc` with the app's address so reminder emails link correctly.
4. **Deploy:** `npm run deploy`. Then open `/setup` on the live app and create the admin login with the setup token.
5. **Connect Shopify:** create a custom app for the store and subscribe these webhooks to `https://<app address>/webhooks/shopify`: `orders/create`, `orders/updated`, `orders/paid`, `orders/cancelled`.
6. **Add the team** on the People screen.
7. **Proof links on dirtygraphix.com (recommended):** in the Shopify custom app, add an app proxy with prefix `apps`, subpath `proof`, and proxy URL `https://<app address>/proof`. Then enter `https://dirtygraphix.com/apps/proof` under Proof settings → Customer link address.
8. **Klaviyo:** build one flow triggered by the "DG Workflow Email" metric, with one branded email that uses the event's `subject`, `heading`, `body`, `button_label` and `button_url`. Turn off Smart Sending for it and ask Klaviyo to mark it transactional, so every proof email sends. Then set the `KLAVIYO_PRIVATE_KEY` secret.
9. **Launch day:** new orders use the proof page. Orders already in Approve Pro finish there (designers mark them "sent in Approve Pro"), then export Approve Pro's records and cancel it.
