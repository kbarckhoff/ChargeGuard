# ChargeGuard — Demo Walkthrough

A script for walking someone through ChargeGuard and explaining what it does. Use the 5-minute version for a quick intro and the full version when someone wants to see the whole flow.

## The one-line pitch
ChargeGuard is the automated version of a hospital chargemaster (CDM) review. What a consultant does by hand over several weeks in Excel, it does in one scan, reproducibly, for any hospital. It finds coding, compliance, and pricing problems in the chargemaster and produces the full client deliverable.

## Who it's for
Revenue-integrity consultants and small-to-mid-size hospitals that lose 1 to 3 percent of revenue to chargemaster problems but can't justify a six-figure enterprise platform like Craneware or Optum.

## Before you demo (2-minute setup)
1. Make sure the sample client is named neutrally. Run once: `node scripts/rename-to-sample.mjs` (renames the demo data to "Sample Hospital").
2. Have the app open and logged in, either the live site or `npm run dev`.
3. Confirm the sample audit already has data loaded and a scan has been run, so Findings and Reports are populated. If not, run a scan first (takes under a minute).
4. Open on the Dashboard so the first thing they see is the headline numbers.

---

## The demo flow

### 1. Dashboard — set the stakes (60 seconds)
Start here. Point to the top numbers: charge lines reviewed, findings, estimated financial impact, and total CDM gross.

Say: "This is Sample Hospital's chargemaster. It has about 8,000 charge lines and 257 million dollars in annual gross charges. ChargeGuard reviewed every line and found a few thousand issues worth several million in impact. A consultant would take weeks to get here. This took one scan."

Point out the navy top nav: Dashboard, Charge Master, Findings, Reports. "Four steps: load the data, scan it, review the findings, hand over the report."

### 2. Charge Master — the inputs (60 seconds)
Click Charge Master. Show the loaded chargemaster table.

Say: "This is the raw chargemaster the client sends us. We also import two supporting files: Revenue and Usage, which tells us volume and payer mix so we can weight findings by real dollars, and the Formulary, which unlocks the pharmacy checks. Everything else the tool already knows, because it maintains its own copy of the CMS fee schedules automatically."

Emphasize the automation: "The hardest part of a tool like this is keeping the Medicare data current every quarter. That refresh is built in and runs itself."

### 3. Run a scan — the engine (30 seconds)
If time allows, click Run CDM Scan (the orange button) and let it run, or show a scan that already completed.

Say: "One click runs the full rule set: status indicators, packaging, pass-through, retired codes, device crosswalks, the pharmacy suite, price transparency, and pricing benchmarks. Every rule traces back to a documented CMS methodology, so the findings are defensible."

### 4. Findings — the value (90 seconds)
Click Findings. This is the heart of the demo. Show the severity summary cards, then scroll the list.

Say: "Every issue is categorized, ranked by severity, and tied to a dollar impact. We can filter by category or severity." Filter to one or two categories to show it working.

Highlight two or three concrete examples that land well:
- A packaging or pass-through finding (shows depth of CMS knowledge).
- A retired-code finding (easy to understand: billing a code that no longer exists).
- A Pricing Benchmark (Peer Comparison) finding (the newest capability): "This line is priced well below what peer hospitals charge for the same service. That is revenue left on the table. And this one is priced far above peers, which is a price-transparency and PR risk."

Say: "This peer-pricing comparison is what the big platforms charge a premium for. ChargeGuard builds it from free public CMS data."

### 5. Reports — the deliverable (60 seconds)
Click Reports. Show the export options.

Say: "This is what the client actually receives. The Excel report is the full deliverable: an executive summary, impact analysis, a department revenue summary, a tab for every category of finding, and a master tab with every line and its flags. It matches the format a seasoned consultant produces."

Then point to the Client Data Request. "Before an engagement even starts, the tool generates the data request form that tells the client exactly which files to send and who owns each one. So the tool bookends the whole engagement, from kickoff to final report."

---

## The three moments that sell it
1. Speed and repeatability: weeks of manual work compressed into one scan, identical every time, for any hospital.
2. Defensibility: every finding maps to a documented CMS rule, and the reference data refreshes itself each quarter.
3. Peer pricing: the "your price versus the market" story that turns a compliance cleanup into a revenue-strategy conversation.

## How to position it against the big players
Say: "We are not trying to replace Craneware or Optum for a large health system. Those are heavy, expensive platforms with long implementations. ChargeGuard is the fast, affordable, defensible CDM review for the consultants and mid-size hospitals they underserve."

## Anticipated questions
- "Where does the reference data come from?" Public CMS fee schedules (OPPS, MPFS, CLFS, ASP, HCPCS) plus, for peer pricing, the CMS outpatient charge file. All refreshed on a schedule.
- "How accurate is it?" The engine was validated against a real consultant's review and reproduces his flag counts to the exact number, including dollar totals to the penny.
- "Can it handle multiple clients?" Yes. Each engagement is its own audit. Load a new client's files, scan, done.
- "What about claims-based issues like modifier-25 or missing charges?" That is the next phase. It needs the client's 837 claims file, and the methodology is already defined.
- "Is our data secure?" Client data lives in the database, not the code, and is never committed to the public repo. Peer benchmarks use only public CMS data.

## Timing
- 5-minute version: Dashboard, then Findings (with the peer-pricing example), then the Excel report. That is the whole story.
- 15-minute version: the full flow above, and run a live scan so they see it happen.
