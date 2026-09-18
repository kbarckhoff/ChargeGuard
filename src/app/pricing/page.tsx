import { createClient } from "@/lib/supabase/server";
import { Badge, ProgressBar, EmptyState } from "@/components/ui/shared";
import { DollarSign, FlaskConical, Stethoscope, Activity, Target, Layers, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const FEE_SCHEDULES: { name: string; icon: LucideIcon; key: string; color: string }[] = [
  { name: "Clinical Lab Fee Schedule", icon: FlaskConical, key: "clinical_lab_fee", color: "#dc2626" },
  { name: "Professional Fee Schedule", icon: Stethoscope, key: "professional_fee", color: "#ea580c" },
  { name: "DME Fee Schedule", icon: DollarSign, key: "dme_fee", color: "#ca8a04" },
  { name: "APC Status T/Q1/Q2/Q3", icon: Activity, key: "apc_t_q", color: "#1e293b" },
  { name: "APC Status S", icon: Target, key: "apc_s", color: "#9333ea" },
  { name: "APC Status X", icon: Layers, key: "apc_x", color: "#0d9488" },
  { name: "Market Pricing", icon: TrendingUp, key: "market", color: "#6b7280" },
];

export default async function PricingPage() {
  const supabase = await createClient();

  const { data: audits } = await supabase.from("audits").select("id").order("created_at", { ascending: false }).limit(1);
  const auditId = audits?.[0]?.id;

  if (!auditId) {
    return (
      <>
        <header className="h-14 border-b border-[#e2e8f0] bg-white px-6 flex items-center flex-shrink-0">
          <h1 className="text-base font-semibold text-[#0f172a]">Pricing Validation</h1>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          <EmptyState icon={DollarSign} title="No audit selected" description="Create an audit and import charge items to run pricing comparisons." />
        </div>
      </>
    );
  }

  // Get pricing comparison stats
  const { data: comparisons } = await supabase
    .from("pricing_comparisons")
    .select("comparison_type, is_below_benchmark")
    .eq("audit_id", auditId);

  const compStats = FEE_SCHEDULES.map((fs) => {
    const items = comparisons?.filter((c) => c.comparison_type === fs.key) || [];
    const below = items.filter((c) => c.is_below_benchmark).length;
    return { ...fs, total: items.length, below };
  });

  return (
    <>
      <header className="h-14 border-b border-[#e2e8f0] bg-white px-6 flex items-center flex-shrink-0">
        <h1 className="text-base font-semibold text-[#0f172a]">Pricing Validation — Phase VI</h1>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          <p className="text-sm text-[#64748b]">
            Compare charge master prices against CMS fee schedules and APC reimbursement rates.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {compStats.map((fs) => {
              const Icon = fs.icon;
              return (
                <div key={fs.key} className="bg-white rounded-xl border border-[#e2e8f0] p-5 hover:shadow-sm transition-shadow">
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-9 h-9 rounded-lg bg-[#f1f5f9] flex items-center justify-center">
                      <Icon size={18} className="text-[#475569]" />
                    </div>
                    {fs.below > 0 && <Badge variant="danger">{fs.below} below</Badge>}
                  </div>
                  <div className="text-sm font-medium text-[#334155] mb-1">{fs.name}</div>
                  {fs.total > 0 ? (
                    <>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-semibold" style={{ color: fs.color }}>{fs.below}</span>
                        <span className="text-sm text-[#94a3b8]">/ {fs.total} compared</span>
                      </div>
                      <div className="mt-2">
                        <ProgressBar value={fs.total - fs.below} max={fs.total} color={fs.color} height={4} />
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-[#94a3b8] mt-2">No comparisons run yet. Import charge items and fee schedule data to begin.</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
