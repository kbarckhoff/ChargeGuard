import { type LucideIcon } from "lucide-react";

// ─── Currency formatting ─────────────────────────────────────
// Compact dollar formatting that scales the suffix: $1,250,600 -> "$1.3M",
// $12,400 -> "$12.4K", $640 -> "$640".
export function formatImpact(n: number): string {
  if (!n || n <= 0) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

// ─── Badge ───────────────────────────────────────────────────
const BADGE_VARIANTS: Record<string, string> = {
  default: "bg-[#eef2f6] text-[#334155]",
  success: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  warning: "bg-amber-50 text-amber-700 border border-amber-200",
  danger: "bg-red-50 text-red-700 border border-red-200",
  info: "bg-blue-50 text-blue-700 border border-blue-200",
  purple: "bg-purple-50 text-purple-700 border border-purple-200",
};

export function Badge({
  children,
  variant = "default",
  className = "",
}: {
  children: React.ReactNode;
  variant?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
        BADGE_VARIANTS[variant] || BADGE_VARIANTS.default
      } ${className}`}
    >
      {children}
    </span>
  );
}

// ─── ProgressBar ─────────────────────────────────────────────
export function ProgressBar({
  value,
  max = 100,
  color = "#1e293b",
  height = 6,
  showLabel = false,
}: {
  value: number;
  max?: number;
  color?: string;
  height?: number;
  showLabel?: boolean;
}) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 rounded-full overflow-hidden" style={{ height, backgroundColor: "#eef2f6" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-[#64748b] font-medium whitespace-nowrap">
          {Math.round(pct)}%
        </span>
      )}
    </div>
  );
}

// ─── KPICard ─────────────────────────────────────────────────
const TILE: Record<string, string> = {
  blue: "bg-[#eaf1fe] text-[#3b82f6]",
  orange: "bg-[#eef2ff] text-[#1e293b]",
  green: "bg-[#e7f7ef] text-[#12b76a]",
  purple: "bg-[#f1ebfe] text-[#7c3aed]",
  amber: "bg-[#fef4e2] text-[#f59e0b]",
};

export function KPICard({
  icon: Icon,
  label,
  value,
  subtext,
  color = "orange",
  highlight = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  subtext?: string;
  color?: "blue" | "orange" | "green" | "purple" | "amber";
  highlight?: boolean;
}) {
  // Highlighted card = filled indigo-to-blue gradient tile (reference hero KPI).
  if (highlight) {
    return (
      <div className="rounded-2xl p-5 text-white shadow-[0_10px_24px_rgba(79,70,229,0.30)] bg-gradient-to-br from-[#1e293b] to-[#3b82f6]">
        <div className="flex items-start justify-between">
          <span className="text-[13px] text-white/85">{label}</span>
          <span className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center"><Icon size={18} /></span>
        </div>
        <div className="text-2xl font-bold tracking-tight mt-3">{value}</div>
        {subtext && <div className="text-xs text-white/80 mt-1">{subtext}</div>}
      </div>
    );
  }
  return (
    <div className="bg-white rounded-2xl border border-[#edf0f4] p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_1px_3px_rgba(16,24,40,0.06)] hover:shadow-md hover:border-[#e2e6ec] transition-all">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${TILE[color] || TILE.orange}`}>
        <Icon size={19} />
      </div>
      <div className="text-2xl font-bold text-[#111827] tracking-tight">{value}</div>
      <div className="text-[13px] text-[#6b7280] mt-0.5">{label}</div>
      {subtext && <div className="text-xs text-[#9aa2af] mt-1">{subtext}</div>}
    </div>
  );
}

// ─── SeverityBar (segmented "findings by severity") ──────────
export function SeverityBar({
  counts,
}: {
  counts: { critical?: number; high?: number; medium?: number; low?: number };
}) {
  const segs = [
    { key: "critical", label: "Critical", color: "#ef4444", n: counts.critical || 0 },
    { key: "high", label: "High", color: "#f97316", n: counts.high || 0 },
    { key: "medium", label: "Medium", color: "#f59e0b", n: counts.medium || 0 },
    { key: "low", label: "Low", color: "#3b82f6", n: counts.low || 0 },
  ];
  const total = segs.reduce((a, b) => a + b.n, 0);
  const stripe = "repeating-linear-gradient(45deg,rgba(255,255,255,0.22) 0 6px,transparent 6px 12px)";
  return (
    <div>
      <div className="flex gap-1 h-6 rounded-lg overflow-hidden mb-3.5">
        {segs.map((s) => (
          <div key={s.key} style={{ flexGrow: Math.max(s.n, 0.01), backgroundColor: s.color, backgroundImage: stripe }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {segs.map((s) => (
          <div key={s.key} className="flex items-center gap-2 text-[13px]">
            <span className="w-3 h-3 rounded" style={{ backgroundColor: s.color }} />
            <span className="text-[#374151]">{s.label}</span>
            <span className="font-bold text-[#111827]">{s.n.toLocaleString()}</span>
          </div>
        ))}
        <div className="flex items-center gap-2 text-[13px] ml-auto text-[#6b7280]">
          Total findings <span className="font-bold text-[#111827]">{total.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Severity helpers ────────────────────────────────────────
export const SEVERITY_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  critical: { color: "#dc2626", bg: "#fef2f2", label: "Critical" },
  high: { color: "#ea580c", bg: "#fff7ed", label: "High" },
  medium: { color: "#ca8a04", bg: "#fefce8", label: "Medium" },
  low: { color: "#1e293b", bg: "#eff6ff", label: "Low" },
  info: { color: "#6b7280", bg: "#f9fafb", label: "Info" },
};

export function SeverityDot({ severity }: { severity: string }) {
  const c = SEVERITY_CONFIG[severity];
  return <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: c?.color }} />;
}

// ─── CDM Color helpers ───────────────────────────────────────
export const CDM_COLORS: Record<string, { color: string; bg: string; label: string }> = {
  red: { color: "#dc2626", bg: "#fef2f2", label: "Invalid Code" },
  blue: { color: "#1e293b", bg: "#eff6ff", label: "Filter Match" },
  green: { color: "#16a34a", bg: "#f0fdf4", label: "Recommended Change" },
  purple: { color: "#9333ea", bg: "#faf5ff", label: "Advisory Review" },
  none: { color: "#6b7280", bg: "#ffffff", label: "No Issues" },
};

export function CDMColorDot({ color }: { color: string }) {
  const c = CDM_COLORS[color];
  if (color === "none") return null;
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-sm"
      style={{ backgroundColor: c?.color }}
      title={c?.label}
    />
  );
}

// ─── Empty State ─────────────────────────────────────────────
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[#f1f5f9] flex items-center justify-center mb-4">
        <Icon size={24} className="text-[#94a3b8]" />
      </div>
      <h3 className="text-base font-semibold text-[#334155] mb-1">{title}</h3>
      <p className="text-sm text-[#94a3b8] max-w-sm mb-4">{description}</p>
      {action}
    </div>
  );
}
