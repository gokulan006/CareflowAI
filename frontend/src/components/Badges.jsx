import { AlertTriangle, Clock, CheckCircle2, RefreshCw, AlertCircle, HelpCircle, ArrowUpRight } from "lucide-react";

export function PriorityBadge({ value, size = "md", showScore = true }) {
  const norm = String(value || "UNASSESSED").toUpperCase();

  const configs = {
    RED: {
      label: "Immediate Review",
      score: "Priority 1",
      bg: "bg-rose-50 text-rose-800 border-rose-300 ring-rose-500/20",
      icon: AlertTriangle,
      dot: "bg-rose-600",
    },
    YELLOW: {
      label: "Prompt Review",
      score: "Priority 2",
      bg: "bg-amber-50 text-amber-800 border-amber-300 ring-amber-500/20",
      icon: Clock,
      dot: "bg-amber-500",
    },
    GREEN: {
      label: "Routine / Normal",
      score: "Priority 3",
      bg: "bg-emerald-50 text-emerald-800 border-emerald-300 ring-emerald-500/20",
      icon: CheckCircle2,
      dot: "bg-emerald-600",
    },
    UNASSESSED: {
      label: "Unassessed",
      score: "Pending",
      bg: "bg-slate-100 text-slate-700 border-slate-300",
      icon: HelpCircle,
      dot: "bg-slate-400",
    },
  };

  const config = configs[norm] || configs.UNASSESSED;
  const Icon = config.icon;
  const isSm = size === "sm";

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-semibold rounded-full border shadow-2xs ${config.bg} ${
        isSm ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      <Icon className={isSm ? "w-3 h-3" : "w-3.5 h-3.5"} />
      <span>{config.label}</span>
      {showScore && norm !== "UNASSESSED" && (
        <span className="opacity-75 font-normal ml-0.5">({config.score})</span>
      )}
    </span>
  );
}

export function StatusBadge({ value, size = "md" }) {
  const norm = String(value || "UNKNOWN").toUpperCase();

  const configs = {
    NEEDS_REVIEW: {
      label: "Needs Review",
      bg: "bg-amber-50 text-amber-800 border-amber-200",
      icon: Clock,
    },
    IN_REVIEW: {
      label: "In Review",
      bg: "bg-sky-50 text-sky-800 border-sky-200",
      icon: RefreshCw,
    },
    NEEDS_INFORMATION: {
      label: "Needs Information",
      bg: "bg-purple-50 text-purple-800 border-purple-200",
      icon: AlertCircle,
    },
    ESCALATED: {
      label: "Escalated",
      bg: "bg-rose-50 text-rose-800 border-rose-300",
      icon: ArrowUpRight,
    },
    APPROVED: {
      label: "Completed / Reviewed",
      bg: "bg-emerald-50 text-emerald-800 border-emerald-200",
      icon: CheckCircle2,
    },
    PROCESSING: {
      label: "Processing AI",
      bg: "bg-indigo-50 text-indigo-800 border-indigo-200",
      icon: RefreshCw,
    },
    PENDING: {
      label: "Pending",
      bg: "bg-slate-100 text-slate-700 border-slate-200",
      icon: Clock,
    },
    REQUESTED: {
      label: "Requested",
      bg: "bg-blue-50 text-blue-800 border-blue-200",
      icon: Clock,
    },
    CONFIRMED: {
      label: "Confirmed",
      bg: "bg-emerald-50 text-emerald-800 border-emerald-200",
      icon: CheckCircle2,
    },
    CANCELLED: {
      label: "Cancelled",
      bg: "bg-slate-100 text-slate-500 border-slate-200",
      icon: AlertCircle,
    },
    COMPLETED: {
      label: "Completed",
      bg: "bg-emerald-50 text-emerald-800 border-emerald-200",
      icon: CheckCircle2,
    },
  };

  const config = configs[norm] || {
    label: norm.toLowerCase().replaceAll("_", " "),
    bg: "bg-slate-100 text-slate-700 border-slate-200",
    icon: HelpCircle,
  };
  const Icon = config.icon;
  const isSm = size === "sm";

  return (
    <span
      className={`inline-flex items-center gap-1 font-medium rounded-md border ${config.bg} ${
        isSm ? "px-1.5 py-0.5 text-xs" : "px-2.5 py-0.5 text-xs"
      }`}
    >
      <Icon className={isSm ? "w-3 h-3" : "w-3.5 h-3.5"} />
      <span className="capitalize">{config.label}</span>
    </span>
  );
}
