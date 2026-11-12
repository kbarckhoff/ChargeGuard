# ChargeGuard → Converge: Transition Plan

A planning document to think through the move *before* we build the rest. Nothing
here is built yet except where noted. The goal is to decide what carries over, what
gets reframed, what we retire, and what we add, and to redraw the end-to-end flow so
it still hangs together.

Read this top to bottom once, then we argue with it.

---

## 1. The real change is the operating model, not the features

ChargeGuard and Converge are built on the **same engine**. The difference is who
drives, how often, and what comes out the other end.

**ChargeGuard** is a self-serve SaaS. The hospital's own CDM staff log in, upload
files, work a queue of findings quarter after quarter, and track what got
implemented. It is an *ongoing operations tool*. Its center of gravity is the
**findings workbench**.

**Converge** is a consultant-delivered diagnostic (Amelior tool + services). The
engine runs against four files in the client's own environment under a BAA, and the
output is a graded picture of the revenue cycle an executive can act on, plus the
same remediation workbench underneath for the people doing the work. It is a
*point-in-time (annual) engagement*. Its center of gravity is the **scorecard +
opportunity model**, with the workbench demoted to a supporting layer.

So the transition is mostly **re-layering what we already have** and **adding the
claims half of the engine**, not throwing work away. ChargeGuard's whole findings
system doesn't disappear. It becomes one of Converge's three output layers.

---

## 2. The organizing principle: Explore / Act / Decide

Greg's concept has three output layers. Everything we own should land in exactly one
of them, and that mapping is the backbone of the whole transition:

| Layer | Audience | What it answers | Mostly built from |
|---|---|---|---|
| **Decide** | CFO / VP Rev Cycle | "How healthy are we, what's the money, what do we do?" | **NEW** — scorecard, opportunity model, exec deck |
| **Explore** | Rev-integrity analyst | "Show me the lines, let me slice it" | ChargeGuard dashboard + findings analytics |
| **Act** | CDM / coding / PFS staff | "What do I fix, who owns it, is it done?" | ChargeGuard findings workbench, queue, change log |

ChargeGuard today is basically **Explore + Act** with no Decide. Converge Phase A
added Decide (scorecard + opportunity). Phase B adds the claims data that makes
Decide honest. That's the entire arc.

---

## 3. What STAYS (carries over, mostly unchanged)

These are the parts of ChargeGuard that keep working as-is. They just get re-labeled
into the layer they belong to.

**The engine — stays verbatim, shared.**
`src/lib/*` (structural-rules, cdm-reference-rules, peer-rules, device-crosswalk,
pharmacy, cms-reference) is the asset. This is the one thing we do **not** fork. A
rule fix must flow both ways. This is already the stated rule of the `converge`
branch.

**Reference data + refreshers — stays.**
The Supabase `cms_reference` tables, the ASP / MPFS / APC / CLFS auto-refreshers, and
the References page (vintage, timestamp, source URL). Converge needs this exactly as
much as ChargeGuard does. One addition later: pin a reference vintage per run so a
diagnostic is reproducible.

**The findings workbench → becomes the "Act" layer. Stays.**
Dispositions (Open / Under Review / Accepted / Denied / N/A), tiers 1–4, the grouped
to-do table, by-CDM-line view, the finding drawer, assign + due date, the exceptions
ledger, the CDM change log, the work queue, accept-writes-pending-change, smart-sync
on re-upload, lagging-EHR reconcile. All of it. This is months of work and it is
precisely the "Act" layer Greg's model calls for. We keep it.

**Findings analytics / dashboard → becomes the "Explore" layer. Stays.**
The category distribution, multi-category filter, per-category counts and impact, the
Excel per-tab export. Reframed as analyst drill-down under the scorecard.

**Intake + imports — stays, with additions (see §4).**
Column-mapping memory by header signature, facility-type rule sets, the 3-step setup.
The mechanics are good; Converge just feeds more files through them.

**Access model additions we already made for this — stay.**
Quarterly run lock, client access duration / expiry at setup, self-service peer
uploads with guidance, per-user permissions. These were built anticipating the
engagement model and they fit Converge cleanly.

**The offline engine (`engine/`) — stays, grows into deployment.**
The standalone tsx CLI that runs the rules with bundled reference data is the seed of
the in-client deployment story (§8).

---

## 4. What CHANGES (same feature, different shape)

**Intake goes from three files to four.**
Today: CDM + R&U + peer MRF. Converge: **CDM + R&U + 837 (claims) + 835
(remittance)**. The 837 parser already exists (`src/lib/claims-parser.ts`). We add an
835 remittance parser and the two new import tiles. This is the single biggest
functional change and it's what unlocks the pending half of the scorecard.

**The setup questionnaire goes from display to gate.**
Phase A built the questionnaire (`src/lib/setup-questionnaire.ts`) and it *shows*
required facts (340B, MAC/locality, CLIA, single/multi-dose, etc.). It needs to
actually **gate the scan**: a rule that depends on 340B status shouldn't fire — or
should fire caveated — until that fact is answered. Right now the gate is cosmetic.

**The run cadence reframes from "quarterly forever" to "annual engagement."**
ChargeGuard's mental model is a hospital doing this itself every quarter. Converge is
an annual diagnostic with a defined access window (the duration/expiry we built).
Same locking machinery, different default cadence and a hard end date. **Decision
needed** (§9): does a Converge client re-run quarterly within their year, or is it
one diagnostic + a remediation window?

**Branding flips to Converge.**
`src/lib/product.ts` already carries `PRODUCT.name`. The sidebar reads from it. Any
remaining hard-coded "ChargeGuard" strings, the logo, email templates, and login need
to follow the product constant so the deployed copy is cleanly Converge-branded while
`main` stays ChargeGuard.

**The dashboard stops being the landing page.**
Today you land on Runs/Dashboard. In Converge the **scorecard** is the front door
(it's already first in the nav). Dashboard becomes a tab inside Explore, not the home
screen.

---

## 5. What's REMOVED or RETIRED (not needed once Converge is whole)

Be careful here — "removed" means *removed from the deployed Converge copy*, not
deleted from the codebase. `main` keeps all of it.

**Cross-client multi-tenancy, in a single-client deployment.**
ChargeGuard's client switcher, `org_members` many-to-many, `is_platform_owner`
platform view, and the admin "create client" flow exist to run many hospitals from
one Amelior-hosted app. In the **per-client in-their-environment** model (§8) each
deployment is one client, isolated under their BAA. Inside that copy the switcher and
the multi-tenant plumbing are dead weight and arguably a compliance liability. They
stay in Amelior's master build; they come **out** of the client deployment.
**Decision needed:** is Converge hosted-by-Amelior-multitenant, deployed-per-client,
or both? This single question drives half of §5 and all of §8.

**Heavy self-serve auth, in a small-team deployment.**
Email OTP, admin-invite-with-temp-password, force-password-change, forgot-password.
These make sense for a hospital's staff self-serving ChargeGuard. For a Converge
deployment with a handful of named consultant + client users, this is probably more
auth than the setting needs. Candidate to simplify (SSO against the client's IdP, or
a short named-user list). **Not urgent; revisit at deployment packaging.**

**The "Generate Updated CDM" button** was already removed from ChargeGuard. Stays
removed. Converge's output is the diagnostic + the change log, not a rewritten CDM
file handed back blind.

**Nothing in the engine is removed.** Worth repeating.

---

## 6. What's ADDED (genuinely new to build)

Ordered by how much they unblock.

**A. The 835 remittance layer (Phase B, biggest lift).**
Parse 835s into a normalized remit schema alongside the existing 837 claim schema.
This produces first-pass yield, denial rate, and net collection yield — the three
headline metrics the scorecard currently shows as "—/pending."

**B. The five cross-file joins (Phase B, the actual "Converge").**
CDM ↔ R&U ↔ 837 ↔ 835. The crown jewel is the **denial → claim → CDM root-cause
trace**: a denied dollar on an 835, back to the claim line on the 837, back to the
CDM/coding defect that caused it. This is what makes a denial *actionable* instead of
just counted. Until this lands, the scorecard's claims-dependent areas (Patient
Access, Case Mgmt/UR, PFS, Underpayment) stay pending — which the scorecard already
shows honestly.

**C. The "Decide" exec deck export (Phase A finish).**
A downloadable deck/PDF of the scorecard + opportunity waterfall + top moves. The
scorecard and opportunity model are built; the export is the missing piece. This is
the single most visible consultant deliverable.

**D. Setup-fact gating wired into the scan (Phase A finish).**
See §4. Turn the cosmetic questionnaire into real rule gates.

**E. Per-run reference-vintage pinning (Phase A finish).**
So re-running a diagnostic six months later reproduces the original, and so a client
can't argue the numbers moved because CMS data moved under them.

**F. The "Explore" skin decoupling (Phase C).**
Make the analytics a swappable view over the engine output rather than hard-wired, so
the three layers are cleanly separable.

**G. In-client deployment packaging (Phase C).**
The offline engine → a real deployable unit the client runs in their environment
under their BAA. The hard part is operational (data residency, update delivery,
support), not code.

---

## 7. The end-to-end flow, redrawn

Two tracks, because Converge has two kinds of users.

### Consultant setup track (once per engagement)
1. **Provision the client** (or stand up their deployment — §8).
2. **Setup questionnaire** — consultant captures the gating facts (340B, MAC
   locality, CLIA, dose form, cost basis, PBD sites, etc.). *These now gate the
   scan.*
3. **Intake the four files** — CDM, R&U, 837, 835 (+ optional peer MRF). Column
   mapping remembered by header signature.
4. **Run the engine.** Structural + reference + pharmacy + peer rules fire on CDM/R&U
   as today; claims rules fire on 837/835; the five joins run.

### Output / delivery track
5. **Decide (front door):** scorecard loads — overall grade, eight functional areas,
   opportunity waterfall, cost of inaction. Consultant reviews, overrides what isn't
   real ("engine computes, consultant judges"), exports the **Decide deck**.
6. **Explore (analyst):** drill from any area into the category distribution and the
   underlying lines. This is the old ChargeGuard dashboard/findings analytics.
7. **Act (staff):** the client's CDM/coding/PFS people work the **findings
   workbench** — assign, disposition, correct, due dates, work queue, change log,
   exceptions. Unchanged from ChargeGuard.
8. **Remediation window / re-run:** within the access year, track implementation; a
   re-run (annual or quarterly per the §9 decision) recomputes the scorecard so the
   grade *moves* — the proof the engagement worked. Smart-sync + lagging-EHR
   reconcile already handle the re-upload mechanics.

The key flow insight: **steps 6–8 already exist and work.** The new flow is almost
entirely steps 2–5. We are bolting a front door and a claims intake onto a house
that's already built.

---

## 8. Deployment model — the fork in the road

This is the biggest architectural unknown and it gates §5. Three options:

- **(a) Amelior-hosted multi-tenant** — what ChargeGuard is today. Easiest to
  operate, keeps the switcher and multi-tenancy. Clients' PHI sits in Amelior's
  Supabase/Vercel. Some health systems won't allow that.
- **(b) Per-client in-their-environment under BAA** — Greg's stated model. Each
  client gets an isolated deployment inside their own cloud/VPC. No cross-tenant
  plumbing. Hardest to operate (updates, support, data residency) but clears the
  compliance bar. The offline `engine/` is the seed.
- **(c) Both** — multi-tenant for clients who'll allow it, per-client for those who
  won't. Most flexible, most maintenance.

We don't have to solve this to keep building Phase B (the claims layer and scorecard
don't care where they run). But we **do** have to decide it before we invest in
deployment packaging, and it decides whether the §5 multi-tenant removals happen.

---

## 9. Open decisions to resolve before building more

1. **Deployment model** — (a), (b), or (c) above. Blocks §5 and §8.
2. **Cadence** — is a Converge engagement one annual diagnostic + remediation window,
   or quarterly re-runs within the access year? Decides the run-lock defaults.
3. **Multi-tenancy** — keep the client switcher in the Converge copy or strip it?
   Falls out of #1.
4. **Auth depth** — keep the full OTP/invite stack or simplify for small named-user
   deployments? Falls out of #1.
5. **Peer MRF in Converge** — does the peer-pricing comparison stay a core Converge
   feature or move to optional? (It's CDM-only and doesn't need claims.)
6. **Who overrides the scorecard** — the "consultant judges" step needs a UI: can a
   consultant mark an area's finding as not-real and have the grade recompute? Not
   built.

---

## 10. Suggested sequence

Phase A is essentially done (scorecard, opportunity, setup questionnaire, nav,
branding, sidebar-on-every-route). To make the diagnostic *trustworthy and
deliverable* without waiting on the big claims lift:

1. **Finish Phase A** — wire setup-fact gates into the scan (6D), per-run reference
   pinning (6E), and the Decide deck export (6C). After this, Converge is a complete,
   demoable CDM-side diagnostic with an exec deliverable.
2. **Decide §9 #1–#4** — the deployment/cadence/auth questions. Cheap to decide, they
   unblock the removals and the deployment work.
3. **Phase B — claims** — 835 parser (6A), then the five joins and the denial→CDM
   trace (6B). This lights up the four pending scorecard areas and is the thing that
   actually earns the name "Converge."
4. **Phase C — deployment + Explore decoupling** — once #2 is decided.

Do **not** start Phase B before Phase A is finished — a half-built front door on top
of a half-built claims layer is harder to reason about than finishing the door first.

---

*Branch note: this all lives on `converge`. `main` stays ChargeGuard and keeps
deploying to production untouched. The engine in `src/lib` is shared — fix it once,
both products get it.*
