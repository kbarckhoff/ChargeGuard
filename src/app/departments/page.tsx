import { createClient } from "@/lib/supabase/server";
import { Badge, EmptyState } from "@/components/ui/shared";
import { Building2, CheckCircle2, Calendar, Clock, ChevronRight } from "lucide-react";

export default async function DepartmentsPage() {
  const supabase = await createClient();

  const { data: audits } = await supabase.from("audits").select("id").order("created_at", { ascending: false }).limit(1);
  const auditId = audits?.[0]?.id;

  if (!auditId) {
    return (
      <>
        <header className="h-14 border-b border-[#e5e5e0] bg-white px-6 flex items-center flex-shrink-0">
          <h1 className="text-base font-semibold text-[#1a1a18]">Department Reviews</h1>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          <EmptyState icon={Building2} title="No audit selected" description="Create an audit to manage department reviews." />
        </div>
      </>
    );
  }

  const { data: meetings } = await supabase
    .from("department_meetings")
    .select("*")
    .eq("audit_id", auditId)
    .order("scheduled_date");

  // Also show Phase V tasks as a fallback
  const { data: phases } = await supabase
    .from("audit_phases")
    .select("id")
    .eq("audit_id", auditId)
    .eq("phase_number", 5)
    .single();

  const { data: tasks } = phases?.id
    ? await supabase
        .from("audit_tasks")
        .select("*")
        .eq("phase_id", phases.id)
        .order("sort_order")
    : { data: [] };

  return (
    <>
      <header className="h-14 border-b border-[#e5e5e0] bg-white px-6 flex items-center justify-between flex-shrink-0">
        <h1 className="text-base font-semibold text-[#1a1a18]">Department Reviews — Phase V</h1>
        <div className="flex items-center gap-2">
          <Badge variant="success">{meetings?.filter((m) => m.status === "completed").length || 0} Completed</Badge>
          <Badge variant="info">{meetings?.filter((m) => m.status === "scheduled").length || 0} Scheduled</Badge>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <p className="text-sm text-[#7a7a75]">
            On-site interactive discussions with revenue department managers to review active charge line items.
          </p>

          {/* Department tasks from Phase V template */}
          <div className="space-y-2">
            {(tasks || []).map((task: any) => {
              const meeting = meetings?.find((m) => task.title.toLowerCase().includes(m.department.toLowerCase().split(" ")[0]));
              const status = meeting?.status || "pending";

              return (
                <div key={task.id}
                  className={`bg-white rounded-xl border p-4 flex items-center gap-4 hover:shadow-sm transition-shadow ${
                    status === "completed" ? "border-emerald-200" : status === "scheduled" ? "border-blue-200" : "border-[#e5e5e0]"
                  }`}>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    status === "completed" ? "bg-emerald-100" : status === "scheduled" ? "bg-blue-100" : "bg-[#f5f5f0]"
                  }`}>
                    {status === "completed" ? <CheckCircle2 size={18} className="text-emerald-600" /> :
                     status === "scheduled" ? <Calendar size={18} className="text-blue-600" /> :
                     <Clock size={18} className="text-[#9a9a95]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[#3d3d3a]">{task.title}</div>
                    <div className="text-xs text-[#9a9a95] mt-0.5">{task.description}</div>
                  </div>
                  <Badge variant={status === "completed" ? "success" : status === "scheduled" ? "info" : "default"}>
                    {status}
                  </Badge>
                  <ChevronRight size={16} className="text-[#c5c5c0]" />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
