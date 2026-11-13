# Dirty Graphix Order & Roll Workflow

Nov 5, 2026 · @TY

## Purpose and scope

Track every order from checkout to print, track design turnaround per order, and batch prints by finish so each roll runs at 95% or better. This system carries order information and material lengths. It never touches the print files themselves.

- **In scope:** order intake, the design queue, design turnaround tracking, print length per job, roll batching by finish, and partial-roll inventory.
- **Out of scope:** artwork and print files.

## Shopify integration

Everything runs through Shopify plus one custom app, keeping outside apps to a minimum.

- **One custom web app connected to Shopify:** the design view, production screen, roll planner, checklists and reports. Everyone signs in with the app's own logins, not Shopify staff accounts. The store is on the Grow plan, which has 5 staff seats, so this keeps the seats free and lets people be added without upgrading. Native B2B is Plus-only, but dealers already run through the dealer-b2b Market, which works on Grow.
- **Shopify stays the source of truth:** orders, customers, rush add-ons, shipping labels and fulfillment. A new order creates a job automatically, and marking the order fulfilled closes the job and sends Shopify's shipping email.
- **Klaviyo, already in place,** sends the branded workflow emails.
- **Shopify Flow, built in,** handles small automations such as tagging rush orders.

**What counts as a design job**

Each line on a Shopify order is sorted when the order arrives:

- **Wrap kits** (products titled "... Wrap Kits"): one design job per kit, with customer proofs. The finish comes from the kit's "Finish Options" choice; on limited-edition kits the variant is the machine model (e.g. Kubota SVL110-3).
- **Sheetz:** their own design job, proofed like a wrap kit. The size and finish come from the "Sheetz Size" and "Finishes" lines.
- **Everything else** (application kits, ADHESOFF, apparel and other products) skips design. It's listed on the order as "Also ships," and an order with nothing to design goes straight to production to ship.
- Option lines from the product options app (Finish, Application Kit) attach to the kit they were added to. Prices in option values are removed, so they never reach design or production.
- Which product titles count as kits, Sheetz or other design products is a setting, so new product types can be added without code changes.

**Replacing Approve Pro**

The built-in proof page replaces Approve Pro. That's one less app, proofs carry Dirty Graphix branding, and proof and approval timestamps feed the design stats directly.

1. From the launch date, every new order uses the new proof page.
2. Orders already in Approve Pro finish their approvals there.
3. Those orders still enter the new system at hand-off: the designer logs the length and marks it "approved in Approve Pro," so material and roll planning stay accurate.
4. Their design stats are left out, since the early timestamps are missing.
5. Once the last in-progress order is approved, export Approve Pro's approval records and cancel it.

## Order flow

Design owns the order until the customer approves and the print length is logged. The production clock starts at hand-off.

1. **Order placed.** The order appears in the design queue, and the job is assigned to a designer. Design stays fully digital, with no printed ticket.
2. **Initial proof.** The designer sends the first mockup as a proof link. The customer taps Approve or Request changes, and both are timestamped automatically. On a multi-machine order, the designer chooses to send one proof sheet for all machines or split it into a separate proof per machine. Split proofs let the customer approve one machine at a time and request changes on another; a single sheet is approved or changed as a whole.
3. **Revisions.** The customer requests changes and the designer sends revisions, repeating as needed. If the customer goes quiet, automatic reminders go out. Designers can also send one by hand from the order at any time, and it's logged with who sent it. That wait counts as customer time, not designer time. After 30 calendar days with no response, the order is marked stalled. This is an internal marker only, so production and material ordering stay on track. It moves to a Stalled list, leaves the designer's active queue, drops out of the material forecast and is flagged to management. Stalled orders stay open indefinitely. If the customer comes back, the order goes back to its designer and the clocks pick up where they left off. Under the policy already on the website, after 45 calendar days the customer's options are to continue the order or take store credit.
4. **Approved.** The customer clicks approve.
5. **Print file.** The designer builds the production print file. Standard and dealer orders are due within 3 business days of approval, rush orders within 1 business day, and custom one-offs within 5 business days. The deadline is the same no matter how many machines are on the order. If a designer is going to miss it, they can pause the print file clock with a required explanation. Every pause is logged with who, when and why, and shows in the weekly report. Reprints are tracked in hours from when the reprint is assigned, with a target of the same day. The designer's screen shows each order's due date, and anything overdue is flagged to the team lead.
6. **Hand-off.** The designer logs the print length and marks the job complete. Production is notified, the job appears on the production screen, and the production clock starts.
7. **Batched and printed.** The roll planner places the job on a roll for its finish.
8. **Shipped.** The customer gets progress and shipping updates throughout.

## Design team

The team lead, Cierra, and Nikki assign orders daily from a workload view that shows each designer's open jobs and average speed. The designers (Andrew, Alissa, Bekah, and Cierra when she takes orders) each have their own login and see only the orders assigned to them. Each gets everything on one card and gives back time spent and print length.

- **Job card:** the full Shopify order: order number and date, customer name, email and phone, shipping address and method, order notes, uploaded files, payment status (no amounts), rush and dealer tags, and every machine on the order with its kit, finish and customizer selections. Prices never show in design or production. Those screens show only whether an order is paid and whether a billing change is pending. Pricing appears only on Nikki's billing screen.
- **Turnaround, not timers:** the system doesn't track minutes per order or per machine. It timestamps each step and measures business-day turnaround: new order to first mockup sent, each revision request to the revision sent back, and approval to print file. Time spent waiting on the customer or on billing doesn't count. Designers have nothing to start or stop. The only pause is on the print file deadline, and it needs an explanation. Orders with more machines get more time: during the baseline month, turnaround is averaged separately for 1-machine, 2-machine and 3+ machine orders, and each group gets its own targets.
- **Material entry:** for each machine on the order, the print length measured at ¼ scale. The system multiplies it by 4 for production and shows the full-size length before hand-off. The finish comes from the order. A job can't be marked print-ready without a length for every machine.
  - **Design checklist:** before hand-off, the designer checks off every item and signs off. Their name and the time are saved with the order. Starting items: all logos in the correct place, and cut contour lines set at the correct amount. Management can add items later. Candidates include names and text spell-checked, finish matches the order, print length matches the file, and the approved proof matches the final file.
    - **Length check:** when a logged print length runs longer than the average for that machine and kit, the designer gets a prompt: "Are you sure you want to push this through at this length?" It's a double-check, not a block. They confirm with a short reason, such as "added extra pieces," and the reason is saved with the order. It triggers at 15% over average. A length 15% under average gets the same prompt, since that usually means a missing piece. Both thresholds can be adjusted.

**Time off**

- The designer or team lead marks a designer out (vacation or sick) with dates, and it's logged with who marked it.
- While they're out, they get no new assignments, and their personal clocks and score pause.
- The team lead reassigns open orders that need work, rush first. Orders waiting on the customer can stay put.
- The order's own clock keeps running, so lead times stay accurate, but that time never counts against the absent designer.

**Orders this month**

- Each designer's screen shows orders assigned to them this month and how many they've handed off.

**How each group in the designer's queue is sorted**

- **Reprint requests:** always on top, oldest request first.
- **Needs first proof:** rush first, then by order date, oldest first.
- **Revision requested:** rush first, then by when the revision request came in, not the original order date. An order placed yesterday whose revision arrived this morning goes ahead of an older order whose revision arrived this afternoon.
- **Waiting on customer or billing:** longest wait first.
- **Approved, print file:** by print file due date, soonest first.

**Custom one-offs**

- Custom one-off orders get extra design time: 5 business days for the first mockup and 5 business days for the print file. Production timing doesn't change.
- They're scored against their own longer targets, so taking one on never hurts a designer's score.
- **Detection:** custom one-offs are their own Shopify products with "custom one-off" in the product name, but no tag yet. Plan: add a "custom-one-off" tag to each of those products (a one-time cleanup) and the app reads the tag on incoming orders. Until every product is tagged, the app also flags any order whose product name contains "custom one-off". The team lead, Nikki or the designer can also mark an order as a custom one-off by hand, with a note.
- They're tagged CUSTOM in the queue so they stand out.

**Notes for production**

- The hand-off box has an optional notes field. The note prints on the production job ticket and shows on the production screen.

**New kit needed**

When an order comes in for a machine without a kit (usually a draft order we create), it goes to kit development before design starts. Kit development locates and brings in the machine to build the template.

1. The team lead or Nikki marks it "New kit needed" when assigning it, or the designer flags it later. It's still assigned to a designer, who owns it the whole way and sees it as "Waiting on new kit" in their queue.
2. Kit development is notified, and the order shows up on their screen. For now that's Cole in production, who manages locating new equipment and building templates. The system treats kit development as its own department, so it can move to a dedicated team later without a rebuild.
3. Kit development works through the checklist from Trello, in four phases, with a named owner on every step. Phase 1 · Template (Cole, then Andrew): profile pics to a new Equipment folder, template, upload template pics, scan, upload scans, then Andrew traces and offsets. Phase 2 · Artwork: Cierra lays out for print, deletes the background and outline, and adds the depth layer, then Alissa applies the design. TY check: TY approves phases 1 and 2 and prices the kit. Phase 3 · Shopify listing: Alissa saves web images; Tara adds the product, applies option sets and creates collections for a new brand or type; Nikki uploads images, adds pricing, sets it active, adds it to the menu if needed, and marks it done. Steps can be done in any order, except the Shopify listing steps, which wait for TY check. When Phases 1 and 2 are complete, the kit moves to TY's list automatically. Only the step's owner (or TY) can check it off. Pricing steps and amounts show only for TY and Nikki. Two milestones control the customer's order. Mockup ready (depth layer added and web images saved): the order releases to its designer's Needs first proof and the design clock starts, so the designer can start designing with the customer while the template is finished. Template ready (trace/offset and layout for print done): the print file and hand-off unlock. Until then the designer can proof but can't hand the order off to production. Each step logs who did it and when.
4. The order goes back to its designer at Mockup ready, not when every step is done, and starts at first proof. No automatic customer notification goes out while a kit is being built, since it can take anywhere from 2 weeks to 3 months.

   Notifications and to-dos: every screen has a bell with an unread count. A notification lands when something becomes ready for that person, not when a kit is created: Cole when a kit starts, Andrew and Cierra once photos and scans are uploaded, Alissa once the depth layer is done, TY when Phases 1 and 2 are done, then Tara, then Nikki. Each person's home screen also has a "Your to-dos" list for work outside their order queue (kit steps and questions from the team) that stays until it's checked off. A chime plays when something new arrives. Email is a backup only: one morning summary of open items, plus a nudge to the person and TY if a step sits for 2 business days.

While an order is in kit development, the designer's clocks pause, and the wait never counts against them. Time in kit development is tracked separately for reports. On a multi-machine order, the designer can keep working on the other machines, but the order hands off only once every machine is ready, so everything still ships together.

**Billing changes**

When a customer changes something that needs a new or updated invoice (a different finish, an added machine, an upgrade), the order goes to billing and the design clocks pause.

1. The designer clicks "Needs billing change" on the order. The request fills in the customer, order, machines and current finishes automatically. The designer picks what changed and adds a note, and one click sends it to Nikki. Designers never see prices. The order moves to a "Waiting on billing" group.
2. Nikki is notified, and the order appears in her billing queue. She updates the order in Shopify and sends the invoice.
3. When the payment comes through, the order releases automatically if Shopify shows it as paid. Otherwise Nikki marks it "Paid, good to go."
4. The designer is notified and the clocks pick back up. The new finish or machines flow into the order card and the roll planner.

Designers can send an order to billing but can't restart the clock themselves. Time waiting on billing is tracked separately in reports. An invoice unpaid for 30 calendar days gets the same stalled treatment as an unanswered proof.

**Nikki's billing screen** is the only place prices appear. It lists requests as To invoice, Invoiced and waiting on payment, and Paid today. Each request shows the customer's contact info, the designer's note, what changed (machine, was and now), the amount already paid, and a suggested price difference pulled from current Shopify prices for her to check. Buttons cover Open order in Shopify, Mark invoice sent, Paid and good to go, and Ask design a question. Her summary shows how many are waiting, the amount outstanding and the average time to paid.

**Requests to the customer**

When an order is missing something, the designer clicks one button on the order and the customer gets a branded email right away.

- **Need logo file:** for a wrong, low-quality or missing logo. The email explains which files work and links to an upload page. Whatever the customer uploads attaches to the order automatically.
- **Need more info:** for anything else, such as the machine year. The designer types the question, it goes into the email, and the customer answers through a reply link.
- **While waiting:** the order moves to "Waiting on customer," the design clocks pause, and the usual automatic reminders run. Designers can also send one by hand, and the 30-day stalled rule applies.
- **When the customer responds:** the upload or answer lands on the order, the designer is notified, and the clocks pick back up.
- Every request is logged with who sent it, when, and what was asked.

**Manual approve or reject**

- For approvals or rejections the customer gives by phone, in person or by text, the designer uses Approve manually or Reject manually on the order.
- Both require how the customer said it and a note on what they said and why. Neither saves without a note.
- The entry goes on the timeline with the designer's name and the time.
- A manual approval starts the print file clock, just like an online one. A manual rejection counts as a revision request.
- The customer gets an email confirming what was recorded, so there's a written record either way.

## Design timing and reports

Every design step is timestamped, so management can see turnaround by designer. Design clocks run Monday through Friday only, so weekends and major holidays never count against a designer. The reports go out by email.

- **Timestamps:** order placed, assigned, initial proof sent, each revision requested, each revision sent, customer approved, print file due, and handed to production.
- **Stats, per designer and overall:** order to initial proof, revision requested to revision sent, revisions per order, order to approval, and active design minutes per order.
- **Delivery:** a weekly email report to management, plus a monthly recap. Daily reporting may come later, depending on production volume.

## Efficiency score

Scores measure what people control, against targets, never against each other. Design is scored per designer, and production as one team. For design, quality comes first (50 points), then speed (35), then output (15), because mistakes are expensive.

**Design score (per designer, out of 100)**

| Measure | Points |
| --- | --- |
| Design-caused reprints (rate per 100 orders) | 45 |
| Revisions per order | 5 |
| Order to first proof | 15 |
| Revision turnaround | 10 |
| Print file on time | 10 |
| Output: orders per business day worked, vs team average | 15 |

**Production score (team, out of 100)**

| Measure | Points |
| --- | --- |
| Batch started the day it's released | 30 |
| Printed to shipped | 30 |
| Production-caused reprints and scrap | 40 |

- **Scoring:** each measure earns full points at its target, and fewer the further it falls short.
- **Not counted:** customer wait time, weekends, holidays and equipment downtime. Roll fill and the number of orders handed off aren't scored, because the planner and the team lead control them.
- **Window:** a rolling 4 weeks. A designer needs at least 15 orders in that window before a score shows. Until then their screen says "Not enough orders yet."
- **Baseline month:** the system runs for a month with scores hidden, then targets are set from real averages.
- **Where it shows:** both TVs show team scores only. Each designer sees their own score on their own screen. Individual design scores go in the management report. The production score is a team report reviewed with the production team.

## Rush orders

Rush jobs jump the line and print right away.

- The customer selects rush and pays extra. The fee and turnaround promise are still to be set. Designers can also mark an order as rush from the order, with a required note. They choose whether the customer is paying for it. If so, a rush-fee request goes to Nikki automatically, like any billing change. If not, the note records why. The order then becomes rush everywhere, and the change is logged with who did it and when. Management can switch the rush option on or off for the store. The Shopify theme needs to support hiding it (to build).
- A rush job goes to the front of the design queue and prints right away at hand-off. The planner fills the rest of that roll with the best-fitting jobs of the same finish, and anything left is saved as a numbered remnant.
- The rush flag shows on both tickets and both views. No daily cap on rush orders for now, since rush volume is low.
  - **Dealer (B2B) orders:** in design they're tagged DEALER but don't jump the line. After hand-off, they get their own priority level below rush. They go to the front of their finish's queue and fill the next batch first. They follow the same 7-business-day hold as everyone else. They're flagged DEALER on tickets and both screens, and dealer lead time shows separately in reports. Dealers are identified the same way the customizer does it, by Shopify's dealer-b2b market, or a dealer checkbox on manual orders.

## Reprints and errors

Reprints and jobs with no Shopify order are entered by hand and run through the same queue and roll math, so every inch of material is accounted for.

- **Entry points:** management and the design team get a Reprint button on any existing order. A separate New manual job entry covers work with no Shopify order: samples, warranty work, internal jobs and orders from other sales systems. It captures the source system, its order number, customer and email, machine, kit, finish, rush, ship-to and price. Manual jobs follow the same path as Shopify orders: assignment, design, proof link, checklist, hand-off and the roll planner, so material stays counted. Shipping is closed out manually with a tracking number, which emails the customer. Every report can filter by source. An alternative is to enter outside orders as Shopify draft orders marked paid, so they follow the normal Shopify path.
- **Fields:** original order, finish, print length, whether it was a design or production error, who made the mistake, what happened, and whether it's a rush.
- **Routing:** a production error goes straight to the production queue at the original print length. A design error goes back to the designer to fix, then hands off as normal. Reprints go to the front of every queue, ahead of rush orders.
- **Material:** reprints and manual jobs go through the roll planner like any order, so their inches come off the right roll or remnant.
- **Scrap:** a misprint caught at the printer is logged against its roll and batch, even if it's reprinted right away.
- **Customer:** progress and shipping updates cover reprints too.
- **Report:** reprint count and inches, broken out by finish, by cause and by person.

**Print errors mid-batch**

1. The operator taps Report print error on the running batch and enters which jobs were hit and how many inches were lost.
2. The scrap is deducted from both the print roll and the laminate roll.
3. The ruined jobs become reprints, logged as production errors, and go to the front of the queue.
4. Jobs that hadn't printed yet are re-planned.
5. The remnant label printed at batch start is voided, and a corrected one prints.
6. If the count is still off, the operator measures the roll and enters the actual length. The correction is logged with who made it and why.
7. The monthly shelf count catches any drift left after that.

**Partial reprints (certain pieces only)**

1. Production logs a Partial reprint on the job from the production screen at the printer, adds a short note (e.g. "panels 3 and 7, left door") and enters the inches lost. Logging is required even when the designer walks over to look in person. A photo is optional. Phone access (scanning the ticket's QR code, with a separate PIN login for production) is an option for later. That scrap comes off both rolls.
2. A reprint request goes to the top of the original designer's queue. If that designer is out, it goes to the team lead.
3. The designer preps only those pieces, logs the reprint length and hands it off. The length check is skipped for reprints.
4. The reprint goes to the front of the production queue, ahead of rush, and batches with its finish.
5. The good pieces are held with the order. The order can't ship until the reprint prints, and its status shows "partial, waiting on R-0014."

The reprint gets its own number, linked to the original order. It logs the photo, pieces, cause, who reported it, inches scrapped and inches reprinted. The designer's time on it is logged but doesn't count against their score when production caused the error. Material and labor go to the order's true cost.

## Views, tickets and notifications

Design and production work from separate views, and each side gets a paper ticket.

- **Design view:** each designer logs in, sees their assigned orders, runs the timer, logs the print length, and marks the job complete.
- **Production view:** one lane per finish (seven total), ordered by urgency: reprints first, then rush, then dealer orders, then the nearest forced-print deadline. Each lane shows its next batch, with the orders in print order, the fill %, and the roll to load (a new roll or a remnant number). Scanning a job into production takes it off the to-print list. A separate receive material screen handles incoming shipments, open orders and the monthly shelf count. A backlog screen shows everything queued per finish in rolls, plus what's still coming from design, with every job listed by planned roll.
- **Tickets:** a standard 4x6 thermal shipping label with a QR code and a barcode. Design stays fully digital, so no ticket prints when an order comes in. Production prints nothing on its own: when the team starts a batch, its job labels print in print order on the 4x6 printer. The remnant label for whatever is left on the roll prints on a second, smaller thermal printer used only for material labels (3 x 2 in labels).
- **Scan tracking:** Two scan points for now. The first is the print computer, when a job prints and goes into production. The second is shipping, when the order is fulfilled in Shopify and Shopify notifies the customer. Each scan timestamps the stage and feeds the stats and efficiency scores.
- **Notifications:** production is notified at hand-off. The customer gets three automatic updates: their order is in the production queue (at hand-off), it's now printing (when its batch starts), and it has shipped (from Shopify). The customer's Shopify order status page also shows the live stage: in design, approved, in the production queue, printing, or shipped.
- **Shop screens:** a TV in the production area and one in the design office show live team scores. Individual scores never go on a TV.

**Sounds**

| Event | Where it plays | Sound |
| --- | --- | --- |
| New order assigned | That designer's screen | Soft chime |
| Revision requested | That designer's screen | Two-tone chime |
| Customer approved | That designer's screen | Short "done" tone |
| Reprint request | Designer and production | Urgent tone, repeats until acknowledged |
| Rush order | Designer and production | Distinct alert, repeats until acknowledged |
| Job handed off | Production screen | Chime |
| Batch ready or forced print due | Production screen | Bell |
| Reorder alert or equipment pause | Production screen | Low tone |

- A designer's sounds play only for their own orders. Only rush and reprint repeat.
- Each screen has volume and mute controls, and sounds play only during business hours.
- Browsers need one click on the page before they'll play sound. A kiosk-mode mini PC on the TVs can skip that.

## Customer emails (draft copy)

Two emails cover the gap between approval and shipping. Shopify's existing shipping email covers the last step. Bracketed items are placeholders.

**Everything stays in the system.** All customer emails send from the no-reply address. A reply gets an automatic kickback pointing the customer to their order page. Each email links to that page, where the customer can approve, request changes, upload files, answer a question or send a message. Every response lands on the order's timeline, the designer is notified, and nothing lives in a personal inbox.

**Proof emails (replacing Approve Pro's emails):** Proof ready (with the proof link), Revision ready, Reminders while a proof waits (automatic on a schedule to be set, or sent by hand from the order), and Approved (a thank-you confirmation). All of them, plus the two below, go out through Klaviyo on one branded template.

**1. In the production queue** (sent at hand-off)

- **Subject:** Your wrap is in the production queue
- **Preview:** Design's locked. Now we print.
- **Body:** Design's done. Your \[machine\] kit is approved and in line for production. We batch prints by finish to keep quality tight and waste low. Most orders print within 7 business days and ship \[X\] business days after. You'll hear from us again the moment it hits the printer. Order #\[number\].
- **Rush version:** Rush order confirmed. Your kit jumps the line and goes to the printer \[next / within X days\].

**2. Now printing** (sent at batch start)

- **Subject:** Your kit is on the printer
- **Preview:** It's happening.
- **Body:** Your \[machine\] kit is printing now in \[finish\]. Once it's off the printer, it gets finished, packed and shipped. Expect tracking within \[X\] business days. It's not just a wrap. It's a brand statement.

**3. Need logo file** (sent from the order)

- **Subject:** We need a better logo file for your wrap
- **Preview:** Quick fix, then we're back to building your kit.
- **Body:** Your \[machine\] kit is in design, but the logo file we got won't print sharp at full size. Send us a vector file and we'll get right back to it. \[Upload your logo\] What works: \[file requirements from the current logo PDF\]. What doesn't: screenshots, phone photos, or logos pulled off a website. No vector file? Tell us on your order page and we'll sort out options.

**4. Need more info** (sent from the order)

- **Subject:** Quick question about your wrap order
- **Preview:** One detail and we're moving.
- **Body:** We're working on your \[machine\] kit and need one thing from you: \[designer's question\]. Tap below to answer. \[Answer now\] The sooner we hear back, the sooner your design is in your inbox.

## Lead-time board (internal, for sales)

A live read on how long orders are actually taking, so sales can quote real timelines. Customers never see it.

- **Headline number:** average days from approval to shipped, across orders shipped in the last 30 days.
- **Broken out:** standard vs rush, and by finish.
- **By stage:** approval to hand-off, hand-off to printing, and printing to shipped, so you can see where time builds up.
- **Updates:** automatically, from the hand-off, batch start and Shopify ship events.

## Material forecasting

The system knows every inch on hand and every inch coming, so it can flag a reorder before a finish runs out.

- **On hand, per material (White and Chrome print media; Gloss, Matte, Prismatic and Gravel Guard laminate):** full rolls in stock plus the inches left on each numbered remnant. Inventory updates in four ways. **Receiving:** when a shipment arrives, production logs the finish and roll count, and each roll gets a number and a 3 x 2 in roll label. **Auto-deduct:** when a batch starts, its inches come off the roll it's printed on, including scrap. **On order:** when a reorder is placed, it's marked with an expected arrival date, so the alert stops repeating. **Count and adjust:** a monthly shelf count corrects any drift, and each adjustment logs who made it and why.
- **Committed:** inches already in the print-ready queue. This number is exact.
- **Coming:** orders still in design are shown as possible demand only, weighted by how often orders at that stage actually reach production. They never trigger a reorder by themselves. Stalled orders are left out entirely.
- **Burn rate:** average inches used per week for each material, including reprints and scrap.
- **Days of supply:** (inches on hand minus committed inches) divided by the burn rate, per material. The burn rate comes from what actually printed, so orders that never get approved never drive a reorder.
- **Reorder alert:** goes to TY and production when a material drops below 15 business days of supply. That covers the worst-case supplier lead time of 10 business days (the range is 7 to 10 from order), plus a proposed 5-day buffer.
- **Weekly report:** inches used, inches wasted and days of supply for each material.

## True cost per order

The system adds up what each order really cost and subtracts it from the Shopify revenue to give the true margin. It rolls up by machine, kit, finish and designer.

- **Material:** footprint inches × (print media cost per inch + laminate cost per inch), each figured as roll price ÷ 1,704.
- **Ink:** inches × ink cost per inch.
- **Design labor:** a flat design cost per machine, set with the other cost inputs.
- **Production labor:** a per-inch or per-batch rate, until start/stop scans exist.
- **Reprints and scrap:** charged to the order that caused them.
- **Waste share:** each roll's true waste spread across its jobs by inches. Saved remnants don't count.
- **Packaging, shipping and fees:** a flat packaging amount per kit, plus label cost and payment fees pulled from Shopify.

## Edge cases

- **Multi-kit orders:** each machine on an order becomes its own job with its own finish and print length. Each machine's print file clock starts when that machine is approved, and the designer can hand machines off as they're ready or all together. Since they usually ship in one box, the planner keeps the order's machines close together: once one machine's batch prints, the order's other machines go to the front of their finish queues, behind reprints and rush. There's no separate force window; they stay on the normal 7-business-day rule. The order ships only when every machine is printed.
- **Cancellations and changes after hand-off:** the job is pulled from its planned batch and the roll is re-planned.
- **Clock days:** every clock, design and production, runs Monday through Friday and pauses on weekends and major holidays. The major holidays are New Year's Day, Memorial Day, Independence Day (July 4), Labor Day, Thanksgiving Day and Christmas Day. The app works out each year's dates on its own. When one lands on a weekend, the weekday it's observed on (the Friday before or the Monday after) is the day off, such as Fri, Jul 3, 2026 and Mon, Jul 5, 2027 (proposed). Management can also add a one-off closure. Business hours are Monday through Friday, 8:00 AM to 4:30 PM Central. Anything measured in hours (reprint turnaround, first proof and revision times) only counts during those hours, so an order or revision that comes in at 4:00 PM and gets answered at 9:00 AM the next day took 1.5 hours, not 17. Anything that arrives after 4:30 PM or on a day off starts its clock at 8:00 AM the next business day. The morning email summary goes out at 8:00 AM. The forced-print hold is 7 business days. The production clock also pauses for equipment malfunctions, and only for those. Whoever pauses it logs their name, the equipment and the reason. Every pause, its length and who started it shows in the weekly report.
- **Permissions:** who can reassign jobs, edit lengths, override a batch or enter reprints.

## Finishes and roll specs

Every print uses two materials: a print media (White or Chrome) and a laminate (Gloss, Matte, Prismatic or Gravel Guard). A whole print roll runs through the laminator with one laminate, so jobs only share a roll when both match. That makes seven finishes, each with its own queue.

**Finishes:** On White print: Gloss (green), Matte (blue), Prismatic (high-vis pink) and Gravel Guard (purple). On Chrome print: Chrome Gloss (neon yellow), Chrome Matte (teal) and Chrome Prismatic (gray). Gravel Guard is White only, and the customizer and system block Chrome with Gravel Guard. Colors match the shop's folders, and every screen uses them.

| Spec | Value |
| --- | --- |
| Usable roll length | 1,704 in (142 ft) for print media, Gloss and Matte laminate; 864 in (72 ft) for Gravel Guard and Prismatic laminate |
| Gap between prints | 3 in (1 in gap plus the barcode) |
| Job footprint | print length + 3 in |
| Fill target | 95% of available length (1,619 in on a full roll) |
| Hold clock | 7 business days from print-ready |

## Roll planner logic

Each finish fills its rolls oldest-first and gap-fills to 95%. Normal jobs never wait more than 7 business days after hand-off, and rush jobs print right away.

1. Queue print-ready jobs by finish: reprints first, then rush, then dealer orders, then machines whose order-mates have already printed, then oldest first.
2. Each job's footprint is its print length plus 3 in (a 1 in gap plus the barcode).
3. Pick one print media roll and one laminate roll for the batch: a numbered remnant if one fits (tightest fit first), otherwise a new 1,704 in roll. The batch can only be as long as the shorter of the two. The system names both rolls to load.
4. Add jobs oldest-first while they fit.
5. When the next oldest job won't fit, check every combination of the remaining jobs for that finish (not just the next few by date) and take the one that best fills the remaining inches without going over. The planner re-runs this every time a job is handed off, edited or removed. If no 95% combination includes the oldest job but newer jobs can fill a roll on their own, that roll prints. The oldest job still forces at 7 business days.
6. Release the batch the moment any combination reaches 95% of the roll's available length. It turns Ready right away and never sits waiting for the 7-day mark.
7. Below 95%, hold the batch. Release it anyway when the oldest job hits 7 business days, or right away if the batch holds a reprint or rush job.
8. Skipped jobs keep their place in line, and their clock keeps running.

**Jobs longer than one roll**

- A job longer than 1,704 in is flagged when the designer logs its length.
- It can be split across two rolls, but they print back-to-back: the second roll loads and prints immediately after the first. The planner never prints one part and holds the other.

**Cut sections**

- The plotter/cutter handles sections of 70–100 ft, so a roll prints in up to two sections of up to 1,200 in (100 ft), with a 12 in gap between them where the roll is cut. The planner places the break wherever it fits the jobs best.
- Jobs never cross a section break. The planner fills section A, then section B, oldest-first, with the same best-fit gap filling.
- The 12 in section gap counts toward the 95% fill.
- A job longer than one section is flagged and split at a panel break into back-to-back sections.
- Laminate is used at the same length as the print.
- **Gravel Guard and Prismatic:** both laminates give 72 ft (864 in) of usable length per roll. Prismatic rolls are 75 ft, with 72 usable. A full print roll for either uses two laminate rolls, one per section, and each section is capped at 864 in or whatever is left on its laminate roll.

**Remnant rolls**

- Anything left on either roll after a batch is saved as its own remnant with a unique number: material code plus sequence, such as WH-015 for White print or GG-009 for Gravel Guard laminate. Remnants belong to a material, not a finish, so a White print remnant can serve any White finish, and a Gloss laminate remnant can serve Gloss or Chrome Gloss.
- The roll gets a 3 x 2 in thermal label from the material-label printer with its number, finish, remaining inches, date and a QR code.
- The system tracks each remnant's remaining inches and calls out its number when a batch should use it.
- A remnant is kept only if it's over 48 in (4 ft). Anything 48 in or shorter counts as waste. Before a short remnant is written off, it's flagged for small products like cooler wraps or decals.

## Worked example

**Full fill.** A Gloss batch on a new roll fills 1,702 of 1,704 in (99.9%) and releases right away. The jobs below are listed oldest to newest.

| Job | Print length (in) | Footprint (in) | Result |
| --- | --- | --- | --- |
| A | 620 | 623 | Placed, oldest first |
| B | 540 | 543 | Placed. 538 in left on the roll |
| C | 600 | 603 | Doesn't fit. Opens the next Gloss roll |
| D | 310 | 313 | Placed to fill the gap |
| E | 220 | 223 | Placed. D + E = 536 in, the tightest fit |
| F | 150 | 153 | Waits for the next roll |

**Forced print.** One Chrome Matte job (903 in footprint) sits for 7 business days with nothing to pair it with. It prints on day 7 at 53% of the roll. The remaining 801 in are logged as a Chrome Matte partial, and the next Chrome Matte batch plans against 801 in, with a 95% target of 761 in.

## Open items

- [ ] Set efficiency score targets after the baseline month
- [ ] Rush fee and turnaround promise
- [ ] Add more scan points later (laminate, cut, QC, pack)?

## Build plan

TY builds it with Claude Code, in phases. Each phase is usable before the next starts. The look is locked: every screen follows design/DESIGN.md and design/tokens.css (saved in this project under workflow-app/) and must match its approved mockup screenshot before it's called done.

1. **Foundation:** a custom Shopify app with its own database. New orders arrive by webhook and become jobs. Includes team lead assignment, the designer view (timer, checklist, length, hand-off) and manual jobs.
2. **Proof page and emails:** a branded proof page served on dirtygraphix.com (like the customizer at /apps/designer), plus the Klaviyo emails. This replaces Approve Pro, so it has to be ready by launch day.
3. **Production:** the roll planner (finishes, cut sections, Gravel Guard and Prismatic rolls, remnants), the production screen, receive material, and 4 x 6 and 3 x 2 labels sent to the Zebras.
4. **Reports and screens:** the weekly and monthly emails, efficiency scores, both TVs and sounds.
5. **Extras:** reprint and print-error flows, stalled orders, the rush on/off switch in the theme, true cost, and material forecasting.

Phases 1–3 are the minimum to run real orders. The canvas mockups and this doc are the spec.

## Launch checklist

**Hardware**

- [x] Second Zebra printer with 3 x 2 in labels (ordered)
- [ ] Confirm the 4 x 6 thermal printer for production (design stays digital, so no office printer)
- [ ] Premium direct-thermal labels for the 3 x 2 printer, or ribbons if it's thermal transfer
- [ ] Plug each printer into the network, or into a computer that stays on
- [ ] USB 2D (QR-capable) scanner for the print computer
- [ ] Two TVs (production and office), each with a mini PC, mounts and speakers
- [ ] Computer or tablet at the printer for the production screen

**Shopify**

- [ ] Staff seats checked: Grow has 5, so the workflow app uses its own logins
- [ ] Confirm all dealer orders come through the dealer-b2b market
- [ ] Set the rush fee and turnaround promise. The rush add-on and on/off switch need theme work.
- [ ] Approve installing the custom app

* [ ] Add a "custom-one-off" tag to every custom one-off product in Shopify (today it's only in the product name)

- [ ] Pick the launch date for the new proof page
- [ ] After the last Approve Pro order is approved, export its records and cancel the app

**Data**

- [ ] Starting inventory: measure every roll and remnant, and label them once the 3 x 2 printer arrives
- [ ] Material costs, ink cost per inch, labor rates, packaging cost (also listed below)
- [ ] Past print lengths by machine and kit, if available
- [ ] Names and emails for designers, team lead and production
- [ ] Supplier for each material

**People and process**

- [ ] Team lead named: Cierra. Nikki also assigns orders.
- [ ] Share the canvas and this doc, then hold the design team meeting (Monday). Production questions: scan points. Design questions: checklist items.
- [ ] Pick the baseline month start date
- [ ] Builder decided: TY with Claude Code

## To do later

Cost inputs for true cost per order. TY will supply these once the build is further along.

- [ ] Roll cost for White and Chrome print media and each of the four laminates
- [ ] Ink cost per inch
- [ ] Design and production labor rates
- [ ] Packaging cost per kit
- [ ] Production labor: a per-inch estimate, or start/stop scans
