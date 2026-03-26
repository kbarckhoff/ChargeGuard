"use client";

import { useState, useTransition } from "react";
import { createFinding, updateFindingStatus } from "@/app/actions";
import { Badge, SeverityDot, SEVERITY_CONFIG } from "@/components/ui/shared";
import { Plus, X, Loader2, ChevronRight, Check, MessageSquare } from "lucide-react";
import type { Finding, FindingSeverity } from "@/types";

export function FindingsList({
  findings,
  auditId,
  phaseId,
}: {
  findings: Finding[];
  auditId: string;
  phaseId: string;
}) {
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<Finding | null>(null);

  return (
    <>
      <div className="flex justify-end mb-3">
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a1a18] text-white rounded-lg text-xs font-medium hover:bg-[#2d2d2a]"
        >
          <Plus size={13} /> New Finding
        </button>
      </div>

      {findings.length === 0 && !showNew ? (
        <div className="py-12 text-center text-[#9a9a95] text-sm">
          No findings recorded for this phase yet.
        </div>
      ) : (
        <div className="space-y-2">
          {findings.map((f) => (
            <div
              key={f.id}
              onClick={() => setSelected(f)}
              className="flex items-start gap-3 p-3 rounded-xl border border-[#e5e5e0] hover:shadow-sm transition-shadow cursor-pointer"
            >
              <SeverityDot severity={f.severity} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <Badge
                    variant={
                      f.status === "resolved" ? "success" : f.status === "accepted" ? "purple" : "default"
                    }
                  >
                    {f.status.replace("_", " ")}
                  </Badge>
                  {f.category && <span className="text-xs text-[#9a9a95]">{f.category}</span>}
                </div>
                <div className="text-sm text-[#3d3d3a] font-medium">{f.title}</div>
                {f.financial_impact && (
                  <span
                    className="text-xs font-medium mt-1 inline-block"
                    style={{ color: SEVERITY_CONFIG[f.severity]?.color }}
                  >
                    ${f.financial_impact.toLocaleString()} est. impact
                  </span>
                )}
              </div>
              <ChevronRight size={16} className="text-[#c5c5c0] mt-1" />
            </div>
          ))}
        </div>
      )}

      {/* New Finding Form */}
      {showNew && (
        <NewFindingForm
          auditId={auditId}
          phaseId={phaseId}
          onClose={() => setShowNew(false)}
        />
      )}

      {/* Finding Detail Drawer */}
      {selected && (
        <FindingDrawer finding={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}

function NewFindingForm({
  auditId,
  phaseId,
  onClose,
}: {
  auditId: string;
  phaseId: string;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      await createFinding({
        audit_id: auditId,
        phase_id: phaseId,
        title: form.get("title") as string,
        description: form.get("description") as string,
        severity: form.get("severity") as FindingSeverity,
        category: form.get("category") as string,
        financial_impact: parseFloat(form.get("financial_impact") as string) || undefined,
        recommendation: form.get("recommendation") as string,
      });
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e5e0]">
          <h2 className="text-lg font-semibold text-[#1a1a18]">New Finding</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-[#f5f5f0] rounded-lg">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-[#3d3d3a] block mb-1.5">Title</label>
            <input name="title" required
              className="w-full px-3 py-2.5 text-sm border border-[#e5e5e0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1a1a18]/10"
              placeholder="Describe the finding…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-[#3d3d3a] block mb-1.5">Severity</label>
              <select name="severity" defaultValue="medium"
                className="w-full px-3 py-2.5 text-sm border border-[#e5e5e0] rounded-xl">
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
                <option value="info">Info</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-[#3d3d3a] block mb-1.5">Category</label>
              <select name="category"
                className="w-full px-3 py-2.5 text-sm border border-[#e5e5e0] rounded-xl">
                <option value="">Select…</option>
                <option value="Invalid Code">Invalid Code</option>
                <option value="Revenue Code">Revenue Code</option>
                <option value="Modifier">Modifier</option>
                <option value="Units">Units</option>
                <option value="Compliance">Compliance</option>
                <option value="Missing Charge">Missing Charge</option>
                <option value="Pricing">Pricing</option>
                <option value="Consistency">Consistency</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-[#3d3d3a] block mb-1.5">Est. Financial Impact ($)</label>
            <input name="financial_impact" type="number" step="0.01"
              className="w-full px-3 py-2.5 text-sm border border-[#e5e5e0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1a1a18]/10"
              placeholder="0.00" />
          </div>
          <div>
            <label className="text-sm font-medium text-[#3d3d3a] block mb-1.5">Description</label>
            <textarea name="description" rows={2}
              className="w-full px-3 py-2.5 text-sm border border-[#e5e5e0] rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-[#1a1a18]/10"
              placeholder="Details about the issue…" />
          </div>
          <div>
            <label className="text-sm font-medium text-[#3d3d3a] block mb-1.5">Recommendation</label>
            <textarea name="recommendation" rows={2}
              className="w-full px-3 py-2.5 text-sm border border-[#e5e5e0] rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-[#1a1a18]/10"
              placeholder="Recommended action…" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-[#5a5a55] hover:bg-[#f5f5f0] rounded-xl">
              Cancel
            </button>
            <button type="submit" disabled={isPending}
              className="px-5 py-2 bg-[#1a1a18] text-white rounded-xl text-sm font-medium disabled:opacity-50 flex items-center gap-2">
              {isPending && <Loader2 size={14} className="animate-spin" />}
              Save Finding
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FindingDrawer({ finding, onClose }: { finding: Finding; onClose: () => void }) {
  const [isPending, startTransition] = useTransition();

  const resolve = () => {
    startTransition(async () => {
      await updateFindingStatus(finding.id, "resolved");
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden animate-slide-in">
        <style>{`@keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}.animate-slide-in{animation:slideIn .2s ease-out}`}</style>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e5e5e0]">
          <div className="flex items-center gap-2">
            <SeverityDot severity={finding.severity} />
            <span className="text-sm font-medium text-[#3d3d3a]">Finding Detail</span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-[#f5f5f0] rounded-lg"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-[#1a1a18] mb-2">{finding.title}</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={finding.severity === "critical" ? "danger" : finding.severity === "high" ? "warning" : "default"}>
                {finding.severity}
              </Badge>
              <Badge variant={finding.status === "resolved" ? "success" : "default"}>
                {finding.status.replace("_", " ")}
              </Badge>
              {finding.category && <Badge>{finding.category}</Badge>}
            </div>
          </div>
          {finding.financial_impact && (
            <div className="p-4 bg-[#fafaf8] rounded-xl border border-[#e5e5e0]">
              <div className="text-xs font-medium text-[#7a7a75] mb-1">Estimated Financial Impact</div>
              <div className="text-xl font-semibold text-[#1a1a18]">${finding.financial_impact.toLocaleString()}</div>
            </div>
          )}
          {finding.description && (
            <div>
              <div className="text-xs font-medium text-[#7a7a75] mb-1">Description</div>
              <div className="text-sm text-[#3d3d3a] leading-relaxed">{finding.description}</div>
            </div>
          )}
          {finding.recommendation && (
            <div>
              <div className="text-xs font-medium text-[#7a7a75] mb-1">Recommendation</div>
              <div className="text-sm text-[#3d3d3a] leading-relaxed">{finding.recommendation}</div>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-[#e5e5e0] flex items-center gap-2">
          <button className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-[#e5e5e0] rounded-lg text-sm font-medium text-[#5a5a55] hover:bg-[#f5f5f0]">
            <MessageSquare size={14} /> Comment
          </button>
          {finding.status !== "resolved" && (
            <button onClick={resolve} disabled={isPending}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
              {isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Resolve
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
