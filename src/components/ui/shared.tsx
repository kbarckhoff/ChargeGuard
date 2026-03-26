import { type LucideIcon } from "lucide-react";

// ─── Badge ───────────────────────────────────────────────────
const BADGE_VARIANTS: Record<string, string> = {
  default: "bg-[#f0f0ec] text-[#3d3d3a]",
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
  color = "#2563eb",
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
      <div className="flex-1 rounded-full overflow-hidden" style={{ height, backgroundColor: "#f0f0ec" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-[#7a7a75] font-medium whitespace-nowrap">
          {Math.round(pct)}%
        </span>
      )}
    </div>
  );
}

// ─── KPICard ─────────────────────────────────────────────────
export function KPICard({
  icon: Icon,
  label,
  value,
  subtext,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  subtext?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-[#e5e5e0] p-5 hover:shadow-md transition-shadow">
      <div className="w-9 h-9 rounded-lg bg-[#f5f5f0] flex items-center justify-center mb-3">
        <Icon size={18} className="text-[#5a5a55]" />
      </div>
      <div className="text-2xl font-semibold text-[#1a1a18] tracking-tight">{value}</div>
      <div className="text-sm text-[#7a7a75] mt-0.5">{label}</div>
      {subtext && <div className="text-xs text-[#9a9a95] mt-1">{subtext}</div>}
    </div>
  );
}

// ─── Severity helpers ────────────────────────────────────────
export const SEVERITY_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  critical: { color: "#dc2626", bg: "#fef2f2", label: "Critical" },
  high: { color: "#ea580c", bg: "#fff7ed", label: "High" },
  medium: { color: "#ca8a04", bg: "#fefce8", label: "Medium" },
  low: { color: "#2563eb", bg: "#eff6ff", label: "Low" },
  info: { color: "#6b7280", bg: "#f9fafb", label: "Info" },
};

export function SeverityDot({ severity }: { severity: string }) {
  const c = SEVERITY_CONFIG[severity];
  return <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: c?.color }} />;
}

// ─── CDM Color helpers ───────────────────────────────────────
export const CDM_COLORS: Record<string, { color: string; bg: string; label: string }> = {
  red: { color: "#dc2626", bg: "#fef2f2", label: "Invalid Code" },
  blue: { color: "#2563eb", bg: "#eff6ff", label: "Filter Match" },
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
      <div className="w-14 h-14 rounded-2xl bg-[#f5f5f0] flex items-center justify-center mb-4">
        <Icon size={24} className="text-[#9a9a95]" />
      </div>
      <h3 className="text-base font-semibold text-[#3d3d3a] mb-1">{title}</h3>
      <p className="text-sm text-[#9a9a95] max-w-sm mb-4">{description}</p>
      {action}
    </div>
  );
}
