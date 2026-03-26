import { createClient } from "@/lib/supabase/server";
import { Badge, ProgressBar, EmptyState } from "@/components/ui/shared";
import { FileText, CheckCircle2, Clock } from "lucide-react";

export default async function ClaimReviewsPage() {
  const supabase = await createClient();

  const { data: audits } = await supabase.from("audits").select("id, total_claims_target").order("created_at", { ascending: false }).limit(1);
  const auditId = audits?.[0]?.id;
  const target = audits?.[0]?.total_claims_target || 100;

  if (!auditId) {
    return (
      <>
        <header className="h-14 border-b border-[#e5e5e0] bg-white px-6 flex items-center flex-shrink-0">
          <h1 className="text-base font-semibold text-[#1a1a18]">Claim Reviews</h1>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          <EmptyState icon={FileText} title="No audit selected" description="Create an audit to begin claim reviews." />
        </div>
      </>
    );
  }

  // Get claim type targets
  const { data: targets } = await supabase.from("claim_type_targets").select("*");

  // Get reviewed counts
  const { data: claims } = await supabase
    .from("claim_reviews")
    .select("claim_type, is_reviewed")
    .eq("audit_id", auditId);

  const reviewed = claims?.filter((c) => c.is_reviewed).length || 0;
  const totalClaims = claims?.length || 0;

  const claimStats = (targets || []).map((t: any) => {
    const typeClaims = claims?.filter((c) => c.claim_type === t.claim_type) || [];
    return {
      ...t,
      reviewed: typeClaims.filter((c) => c.is_reviewed).length,
      total: typeClaims.length,
      done: typeClaims.filter((c) => c.is_reviewed).length >= t.minimum_claims,
    };
  });

  return (
    <>
      <header className="h-14 border-b border-[#e5e5e0] bg-white px-6 flex items-center flex-shrink-0">
        <h1 className="text-base font-semibold text-[#1a1a18]">Claim Reviews — Phase IV</h1>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Progress */}
          <div className="bg-white rounded-xl border border-[#e5e5e0] p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[#3d3d3a]">Medicare Outpatient Claim Review</h3>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-semibold text-[#1a1a18]">{reviewed}</span>
                <span className="text-sm text-[#9a9a95]">/ {target} minimum</span>
              </div>
            </div>
            <ProgressBar value={reviewed} max={target} color="#2563eb" height={8} showLabel />
          </div>

          {/* Claim Type Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {claimStats.map((ct: any) => (
              <div key={ct.claim_type}
                className={`bg-white rounded-xl border p-4 ${ct.done ? "border-emerald-200" : "border-[#e5e5e0]"}`}>
                <div className="flex items-center justify-between mb-2">
                  {ct.done ? <CheckCircle2 size={16} className="text-emerald-600" /> : <Clock size={16} className="text-[#9a9a95]" />}
                  {ct.done ? <Badge variant="success">Complete</Badge> : <Badge>{ct.reviewed}/{ct.minimum_claims}</Badge>}
                </div>
                <div className="text-sm font-medium text-[#3d3d3a] mb-1">
                  {ct.claim_type.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                </div>
                <div className="text-xs text-[#9a9a95] mb-2">{ct.description}</div>
                <ProgressBar value={ct.reviewed} max={ct.minimum_claims} color={ct.done ? "#16a34a" : "#2563eb"} height={4} />
                <div className="text-xs text-[#9a9a95] mt-2">Docs: {ct.supporting_docs}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
