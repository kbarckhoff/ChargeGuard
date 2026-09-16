# Sample Hospital — Run 2 test edits

Re-upload these three files to the **same Sample Hospital review** (or start a new
quarter for it) and re-run, then check the Change Log / Findings against this list.
Everything else is byte-identical to run 1, so any other finding should simply
re-appear (recurring), and anything you accepted/denied in run 1 should carry its
disposition forward on the unchanged lines.

## New issues (should appear for the first time in run 2)
- **Zero price** — procedure_number `9022`, `901922`, `901951` (gross set to 0)
- **No revenue code** — procedure_number `67257` (revenue code removed)
- **Duplicate line** — `380209` (copy of `38020`), `381309` (copy of `38130`) — same HCPCS/rev/price

## Fixed / updated lines (tool should see these as changed since run 1)
- **Price raised** — `510060` (56 → 89.60), `38068` (41 → 65.60), `38229` (56.20 → 89.92)
  — if these were flagged underpriced in run 1, they should now resolve/close.
- **Modifier added** — `510021`, `610021` (modifier_1 blank → 26)

## Revenue & Usage changes
- **Dropped to zero volume** — charge_code `90500`, `69034`, `42801` (units → 0)
  — should surface as low/no-volume (RVU) and change materiality on any related finding.
- **Volume doubled** — `91112`, `55004`, `69011` (units ×2) — materiality shift only.

## Formulary changes
- **Marked inactive (status ON → OFF)** — charge_code `12329` (Keytruda), `12386` (Evenity)
  — if still billed, should flag "inactive drug still billed."
- **Unit-of-measure changed (mg → mL)** — charge_code `11629`, `11623` — should flag UOM mismatch.

## What to look for
1. The **Change Log / re-upload sync** should list the changed CDM lines as updated.
2. Findings you **accepted** in run 1 on unchanged lines should carry forward (not re-open).
3. A fix you accepted in run 1 that is now actually corrected in the CDM should move to
   **closed/applied**; if the CDM still shows the old value, it should show as **lagging / pending EHR sync**.
4. New issues above should be net-new findings; recurring ones should keep their tier/history.
