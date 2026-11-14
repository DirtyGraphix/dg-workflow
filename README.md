# dg-workflow

Design and production workflow app for Dirty Graphix. It runs on Cloudflare (Workers, D1, R2) with a React front end. Customer emails send through Resend.

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
- **Emails** queue in the app first, then go out through Resend in one branded layout built from `design/tokens.css`. Nothing sends until TY turns on sending in Proof settings; until then the log shows them as waiting. "Send test to me" checks the setup first.

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

**Database changes:** a new file in `migrations/` must be applied to the live database before its pull request is merged: `npx wrangler d1 migrations apply dg-workflow --remote` (or Claude applies it through the Cloudflare connection and records it in `d1_migrations`).

These steps need TY's accounts. Claude can walk through each one.

1. **Database and file storage** (done Nov 14, 2026): D1 database `dg-workflow` and R2 bucket `dg-workflow-proofs` in the Dirty Graphix Cloudflare account, with migrations 0001 and 0002 applied.
2. **Deploys:** Cloudflare Workers Builds is linked to this GitHub repo and deploys `main` on every merge (build command `npm run build`, deploy command `npx wrangler deploy`).
3. **Secrets** (set in Cloudflare under the Worker's Settings → Variables and Secrets, never in the code): `SETUP_TOKEN` (any long random phrase, used once to create TY's login), `RESEND_API_KEY` (customer emails) and, at Shopify hookup, `SHOPIFY_WEBHOOK_SECRET`.
4. **First login:** open `/setup` on the live app and create the admin login with the setup token.
5. **Connect Shopify:** create a custom app for the store and subscribe these webhooks to `https://<app address>/webhooks/shopify`: `orders/create`, `orders/updated`, `orders/paid`, `orders/cancelled`.
6. **Add the team** on the People screen.
7. **Proof links on dirtygraphix.com (recommended):** in the Shopify custom app, add an app proxy with prefix `apps`, subpath `proof`, and proxy URL `https://<app address>/proof`. Then enter `https://dirtygraphix.com/apps/proof` under Proof settings → Customer link address.
8. **Customer emails (Resend):** dirtygraphix.com's DNS is at Wix, and Cloudflare's own email service only works on Cloudflare DNS, so emails go through Resend (free: 3,000 a month, 100 a day). Create a Resend account, add the domain dirtygraphix.com, and add the DNS records Resend lists in Wix (they sit on the `send` and `resend._domainkey` names, so they don't touch the store or the office inbox). Once Resend shows it verified, create an API key with "Sending access" and add it in Cloudflare as the secret `RESEND_API_KEY` (Worker → Settings → Runtime variables and secrets). In Proof settings, click "Send test to me", and once it arrives, turn on "Send customer emails".
9. **Launch day:** new orders use the proof page. Orders already in Approve Pro finish there (designers mark them "sent in Approve Pro"), then export Approve Pro's records and cancel it.
