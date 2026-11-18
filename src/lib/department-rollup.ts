// ─── Department rollup (Converge, uses the GL/department file) ─
// Rolls findings up by department so a CFO sees which departments are the
// "problem children." Greg's method: charge numbers begin with a department
// code, and the Finance GL file maps each charge-code prefix to a department.
// We assign every finding to a department by longest-prefix match on its CDM
// line's charge code, then aggregate count + dollar impact + top categories.
// Pure functions; no I/O.

export interface GlRow { gl_number: string | null; department_name: string | null; charge_prefix: string | null }
export interface RollupFinding {
  charge_code: string | null;      // CDM line charge/procedure number
  category: string | null;
  financial_impact: number | null;
}

export interface DeptRollupLine {
  department: string;
  gl_number: string | null;
  findings: number;
  impact: number;
  topCategories: { category: string; count: number; impact: number }[];
}
export interface DeptRollup {
  departments: DeptRollupLine[];   // sorted by impact desc
  unassigned: DeptRollupLine;      // findings whose charge code matched no prefix
  totalFindings: number;
  totalImpact: number;
}

const digits = (s: any) => String(s ?? "").replace(/\s/g, "").trim();

/** Build a prefix → {department, gl} lookup, longest prefixes first. */
function prefixMap(gl: GlRow[]): { prefix: string; dept: string; gl: string | null }[] {
  return gl
    .filter((g) => g.charge_prefix && g.department_name)
    .map((g) => ({ prefix: digits(g.charge_prefix), dept: String(g.department_name), gl: g.gl_number || null }))
    .filter((g) => g.prefix)
    .sort((a, b) => b.prefix.length - a.prefix.length); // longest match wins
}

export function buildDepartmentRollup(findings: RollupFinding[], gl: GlRow[]): DeptRollup {
  const prefixes = prefixMap(gl);
  // department name → aggregate
  const byDept = new Map<string, { gl: string | null; findings: number; impact: number; cats: Map<string, { count: number; impact: number }> }>();
  const ensure = (dept: string, glNum: string | null) => {
    let e = byDept.get(dept);
    if (!e) { e = { gl: glNum, findings: 0, impact: 0, cats: new Map() }; byDept.set(dept, e); }
    return e;
  };
  const UN = "Unassigned";

  for (const f of findings) {
    const code = digits(f.charge_code);
    const hit = code ? prefixes.find((p) => code.startsWith(p.prefix)) : undefined;
    const dept = hit ? hit.dept : UN;
    const e = ensure(dept, hit ? hit.gl : null);
    e.findings++;
    const imp = Number(f.financial_impact) || 0;
    e.impact += imp;
    const cat = (f.category || "Uncategorized").trim();
    const c = e.cats.get(cat) || { count: 0, impact: 0 };
    c.count++; c.impact += imp; e.cats.set(cat, c);
  }

  const toLine = (dept: string, e: { gl: string | null; findings: number; impact: number; cats: Map<string, { count: number; impact: number }> }): DeptRollupLine => ({
    department: dept, gl_number: e.gl, findings: e.findings, impact: e.impact,
    topCategories: [...e.cats.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.impact - a.impact || b.count - a.count).slice(0, 3),
  });

  const departments = [...byDept.entries()].filter(([d]) => d !== UN).map(([d, e]) => toLine(d, e)).sort((a, b) => b.impact - a.impact || b.findings - a.findings);
  const unE = byDept.get(UN);
  const unassigned = unE ? toLine(UN, unE) : { department: UN, gl_number: null, findings: 0, impact: 0, topCategories: [] };

  return {
    departments,
    unassigned,
    totalFindings: findings.length,
    totalImpact: findings.reduce((s, f) => s + (Number(f.financial_impact) || 0), 0),
  };
}
