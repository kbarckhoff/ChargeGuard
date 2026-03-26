import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { Badge, ProgressBar, SeverityDot, EmptyState } from "@/components/ui/shared";
import { TaskList } from "@/components/audit/TaskList";
import { FindingsList } from "@/components/audit/FindingsList";
import { Check, AlertTriangle } from "lucide-react";
import Link from "next/link";

export default async function AuditDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ phase?: string }>;
}) {
  const { id } = await params;
  const { phase: phaseParam } = await searchParams;
  const supabase = await createClient();

  const { data: audit, error } = await supabase
    .from("audits")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !audit) notFound();

  // Get phases with task counts
  const { data: phases } = await supabase
    .from("audit_phases")
    .select("*")
    .eq("audit_id", id)
    .order("phase_number");

  const { data: allTasks } = await supabase
    .from("audit_tasks")
    .select("id, phase_id, status")
    .eq("audit_id", id);

  // Determine active phase
  const activePhaseNum = phaseParam ? parseInt(phaseParam) : 1;
  const activePhase = phases?.find((p) => p.phase_number === activePhaseNum) || phases?.[0];

  // Get tasks for active phase
  const { data: phaseTasks } = await supabase
    .from("audit_tasks")
    .select("*")
    .eq("phase_id", activePhase?.id)
    .order("sort_order");

  // Get findings for active phase
  const { data: phaseFindings } = await supabase
    .from("findings")
    .select("*")
    .eq("phase_id", activePhase?.id)
    .order("created_at", { ascending: false });

  return (
    <>
      <header className="h-14 border-b border-[#e5e5e0] bg-white px-6 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-base font-semibold text-[#1a1a18]">{audit.hospital_name}</h1>
          <p className="text-xs text-[#9a9a95]">{audit.name}</p>
        </div>
        <Badge variant={audit.status === "in_progress" ? "info" : "default"}>
          {audit.status.replace("_", " ")}
        </Badge>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Phase Timeline */}
          <div className="bg-white rounded-xl border border-[#e5e5e0] p-5">
            <div className="flex items-center gap-0 overflow-x-auto pb-1">
              {(phases || []).map((phase, i) => {
                const taskCount = allTasks?.filter((t) => t.phase_id === phase.id) || [];
                const completedCount = taskCount.filter((t) => t.status === "completed").length;
                const pct = taskCount.length > 0 ? Math.round((completedCount / taskCount.length) * 100) : 0;
                const isActive = phase.phase_number === activePhaseNum;
                const isDone = pct === 100;

                return (
                  <div key={phase.id} className="flex items-start">
                    <Link
                      href={`/audits/${id}?phase=${phase.phase_number}`}
                      className={`flex flex-col items-center min-w-[100px] px-2 py-2 rounded-lg transition-all ${
                        isActive ? "bg-[#1a1a18] text-white" : "hover:bg-[#f5f5f0]"
                      }`}
                    >
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm mb-1.5 ${
                          isDone
                            ? isActive ? "bg-emerald-400 text-white" : "bg-emerald-100 text-emerald-700"
                            : pct > 0
                            ? isActive ? "bg-blue-400 text-white" : "bg-blue-100 text-blue-700"
                            : isActive ? "bg-[#3d3d3a] text-[#9a9a95]" : "bg-[#f0f0ec] text-[#7a7a75]"
                        }`}
                      >
                        {isDone ? <Check size={14} /> : phase.phase_number}
                      </div>
                      <span className={`text-[11px] font-medium text-center leading-tight ${isActive ? "text-white" : "text-[#3d3d3a]"}`}>
                        {phase.name.length > 14 ? phase.name.slice(0, 14) + "…" : phase.name}
                      </span>
                      <span className="text-[10px] text-[#9a9a95] mt-0.5">{pct}%</span>
                    </Link>
                    {i < (phases?.length || 0) - 1 && (
                      <div className="flex items-center pt-4 px-0">
                        <div className={`w-4 h-0.5 ${isDone ? "bg-emerald-300" : "bg-[#e5e5e0]"}`} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Phase Workspace */}
          {activePhase && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Tasks */}
              <div className="bg-white rounded-xl border border-[#e5e5e0] p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-[#3d3d3a]">
                    Phase {activePhase.phase_number}: {activePhase.name}
                  </h3>
                  <Badge>
                    {phaseTasks?.filter((t) => t.status === "completed").length || 0}/{phaseTasks?.length || 0}
                  </Badge>
                </div>
                <TaskList tasks={phaseTasks || []} />
              </div>

              {/* Findings */}
              <div className="lg:col-span-2 bg-white rounded-xl border border-[#e5e5e0] p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-[#3d3d3a]">
                    Findings — Phase {activePhase.phase_number}
                  </h3>
                  <Badge>{phaseFindings?.length || 0} findings</Badge>
                </div>
                <FindingsList findings={phaseFindings || []} auditId={id} phaseId={activePhase.id} />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
