# ChargeGuard — What It Does, Why It Matters, and How It Works

A companion to the demo walkthrough. This is the background you speak from: the process we emulated, why hospitals should care, and the technical detail to explain when someone asks how it actually works.

---

## 1. The problem, in plain terms

Every hospital runs a Charge Description Master, or CDM (also called the chargemaster). It is the master list of every billable item and service the hospital offers, and for each line it holds a description, a billing code (CPT or HCPCS), a revenue code, a price, and other billing attributes. A mid-size hospital's CDM has several thousand to tens of thousands of lines, and every claim the hospital sends to Medicare or a commercial payer is built from it.

The chargemaster is also constantly going out of date. CMS updates its codes and payment rules every quarter. Codes get retired, new ones appear, packaging and status-indicator rules change, and prices drift away from the market. When the CDM is wrong, the hospital gets denials, underpayment, compliance exposure, and lost revenue. Industry estimates put charge-capture and chargemaster losses at roughly 1 to 3 percent of gross revenue, which for a hospital billing hundreds of millions is millions of dollars a year.

The catch is that reviewing a chargemaster properly requires a specialist who knows CMS billing rules cold and is willing to go line by line. That expertise is scarce and expensive, and the work is slow and manual. That is the gap ChargeGuard fills.

---

## 2. The methodology the tool is built on

ChargeGuard is built on a real, proven chargemaster-review methodology, developed from established expert practice and refined with input from experienced peers in the field. The key was starting from a documented, reproducible process rather than ad-hoc judgment. That is what made it possible to turn into software.

The methodology has three parts, and the tool replicates all three:

The **inputs** collected from a client. The chargemaster itself, a Revenue and Usage file (volume and payer mix per line, so findings can be weighted by real dollars), and a pharmacy formulary (which unlocks the drug-specific checks). Later phases add the hospital's actual claims. It also uses a standard client data-request form that tells each department exactly what to send.

The **review logic**. A set of about two dozen numbered steps and roughly 26 distinct flag patterns, each grounded in a specific CMS rule. Things like: is this code bundled or separately payable, has this code been retired, is this drug billed in the right units, is this price defensible. Each pattern has a clear definition and a clear recommendation.

The **deliverable**. A standardized report, originally a 32-tab Excel workbook, with an executive summary, an impact analysis, a tab for each category of finding, and a master view of the whole chargemaster with every flag.

We ported that methodology into the tool and validated it against an expert review of a real hospital. The engine reproduces that review's flag counts exactly, including dollar totals that tie to the penny. That is the important credibility point: ChargeGuard is not an approximation of expert judgment, it reproduces a proven expert review's results, and it does it the same way every time for any hospital.

---

## 3. What the tool actually checks (and the CMS concept behind each)

When you demo the Findings screen, this is what the categories mean. You do not need to recite all of it, but knowing the concept behind each lets you answer "what is this checking?"

**Status-indicator logic.** Under the Medicare outpatient payment system (OPPS), every code carries a status indicator that says how it gets paid. The tool flags codes that are bundled and should not be billed separately (SI=B), codes that are conditionally packaged (SI=Q1 through Q4), pass-through items that are separately payable and should be captured (SI=J, K), and non-OPPS items paid off a different fee schedule (SI=A). Getting these wrong means either lost revenue or non-compliant billing.

**Coding validity.** Retired HCPCS codes that no longer exist, new or recommended codes the hospital is missing, vaccine administration coding, the same code carrying conflicting revenue codes, add-on codes with no primary procedure, and hard-coded modifiers that should not live in the CDM.

**Device-to-procedure crosswalk.** Certain procedures require a device code and vice versa. The tool checks both directions using the CMS I/OCE edits and device revenue-code logic, so an implant procedure without its device code, or a device line with no code, gets caught.

**Pharmacy suite.** Inactive formulary drugs still being billed, mismatches between the drug code on the CDM and the formulary's NDC, unit-of-measure mismatches, and billing-unit errors where the price implies the wrong dosage multiple. Drug billing units are a common and expensive source of error.

**Pricing.** Lines priced at zero, extreme outliers within a department, inconsistent prices for the same code, and prices below the Medicare fee schedule. And now the peer-pricing benchmark, which compares each price to what other hospitals actually charge for the same service.

**Price transparency.** The 70 shoppable services CMS requires hospitals to publish, checked for presence and pricing, which supports transparency-rule compliance.

Underneath all of this, findings are weighted by the Revenue and Usage data, so a problem on a high-volume, high-dollar line ranks above a trivial one. That is how the tool turns thousands of technical flags into a prioritized, dollar-ranked action list.

---

## 4. Why this is valuable to a hospital

Say it in terms of outcomes:

It recovers revenue the hospital is already entitled to, by catching underpricing, missed separately-payable items, and unit errors. It prevents denials, because it fixes the coding and revenue-code problems that cause claims to bounce before they go out. It reduces compliance risk, because bundled-billing and hard-coded-modifier problems are exactly what auditors look for. It supports price-transparency compliance, which carries real penalties. And with peer pricing, it makes the hospital's prices defensible, which matters when a board or a payer asks why a service costs what it does.

Then the business case for why the tool, not a person: the same review that takes a consultant weeks runs in one scan, it is identical every time, it works for any hospital, and it is affordable enough for the mid-size and critical-access hospitals that cannot justify a six-figure enterprise platform. It also maintains its own CMS reference data automatically, which is the part that normally makes these tools expensive to keep accurate.

---

## 5. How the platform works (the technical answer)

When someone asks how it is built, here is the honest, specific version.

**The stack.** It is a web application built on Next.js and TypeScript, with a Supabase Postgres database for storage and authentication, deployed on Vercel. Everything runs in the browser plus serverless functions, so there is nothing to install.

**The data model.** Each engagement is an "audit." Under it sit the charge items (the imported chargemaster), the usage data, the formulary, and the findings the scan produces. Keeping each client in its own audit is what makes it multi-client.

**The CMS reference layer.** This is the part that makes the results authoritative. The tool keeps its own copy of the CMS fee schedules: the OPPS addenda (status indicators and payment rates), the physician fee schedule, the clinical lab fee schedule, the drug ASP pricing, and the quarterly HCPCS code list. That is around twenty thousand codes. A refresh pipeline discovers the newest quarterly files on the CMS website, downloads them, stages them, shows what changed, and promotes them into the engine, so the reference data stays current without manual data entry. All codes are normalized to a single canonical format so lookups are reliable regardless of how the client formatted them.

**The scan engine.** When you click Run Scan, the engine loads every charge line for that audit, joins it against the CMS reference data and the usage and formulary files, and runs the full rule set in one pass. Each rule is a self-contained function that emits findings with a severity, a category, a dollar impact, and a plain-English recommendation. Every rule maps back to a documented CMS concept, which is what makes the findings defensible rather than a black box.

**The peer-pricing benchmark.** This one uses a public CMS dataset of what hospitals across the country actually charge for each outpatient service, summarized to national and state averages. A builder script turns that file into a lookup table, and a rule compares each of the client's prices to the peer average, flagging both the lines priced well below the market (revenue opportunity) and the lines priced far above it (transparency and PR risk).

**The report generator.** The export builds the full Excel deliverable server-side: an executive summary, an impact analysis, a department revenue summary, a tab for each finding category, and a master tab. It also generates the client data-request form. The output is designed to match the format a seasoned consultant hands over.

**Security.** Client chargemaster data lives in the database, never in the code repository, and the administrative database key is used only on the server, never exposed to the browser. The peer benchmark uses only public CMS data.

---

## 6. Explaining the tech simply during a demo

If your audience is not technical, these one-liners land better than the detail above:

"Think of it as a spell-checker for the hospital's billing list, except the dictionary is the entire Medicare rulebook, and it updates itself every quarter."

"The hard part of any tool like this is keeping the Medicare data current. We automated that, so the tool is always checking against this quarter's rules, not last year's."

"Every flag it raises can be traced to a specific CMS rule. It is not guessing, and it is not a black box. That is what makes the report defensible in an audit."

"It reproduces a real expert's review to the exact number. We did not build a tool that is sort of like a consultant. We built the consultant's exact process into software."

If they are technical, walk them from the data model to the reference layer to the scan engine to the report, in that order. The story is always: current CMS reference data, times the client's chargemaster, run through a documented rule set, equals a prioritized, dollar-ranked, defensible finding list and a finished deliverable.
