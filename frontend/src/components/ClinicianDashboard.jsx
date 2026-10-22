import { useState, useMemo, useEffect } from "react";
import {
  Clock,
  AlertTriangle,
  RefreshCw,
  Search,
  Download,
  ArrowUpDown,
  ChevronRight,
  TrendingUp,
  PieChart,
  UserCheck,
  Archive,
} from "lucide-react";
import { PriorityBadge, StatusBadge } from "./Badges";
import { apiRequest } from "../api";

export default function ClinicianDashboard({
  cases = [],
  currentUser,
  onOpenCase,
  onRefresh,
  busy = false,
}) {
  const [activeView, setActiveView] = useState("queue"); // "overview" | "queue"
  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [assignmentFilter, setAssignmentFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState("priority"); // "priority" | "wait_time" | "name" | "status"
  const [sortOrder, setSortOrder] = useState("asc"); // "asc" | "desc"
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(() => new Date());
  const [nowTimestamp, setNowTimestamp] = useState(() => Date.now());
  const [caseToArchive, setCaseToArchive] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const [archiveNotice, setArchiveNotice] = useState("");

  // Update current time on refresh
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      onRefresh?.().then(() => {
        setLastRefreshed(new Date());
        setNowTimestamp(Date.now());
      });
    }, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, onRefresh]);

  // Real Calculated Metrics
  const metrics = useMemo(() => {
    const total = cases.length;
    const awaitingTriage = cases.filter((c) => c.status === "NEEDS_REVIEW").length;
    const inReview = cases.filter((c) => c.status === "IN_REVIEW").length;
    const highPriority = cases.filter((c) => c.priority === "RED").length;
    const completed = cases.filter((c) => c.status === "APPROVED").length;

    // Average waiting time for pending cases
    const pendingCases = cases.filter((c) => c.status !== "APPROVED");
    let avgWaitMinutes = 0;
    if (pendingCases.length > 0) {
      const totalMinutes = pendingCases.reduce((acc, c) => {
        const created = new Date(c.created_at).getTime();
        return acc + Math.max(0, Math.floor((nowTimestamp - created) / 60000));
      }, 0);
      avgWaitMinutes = Math.round(totalMinutes / pendingCases.length);
    }

    const priorityCounts = {
      RED: cases.filter((c) => c.priority === "RED").length,
      YELLOW: cases.filter((c) => c.priority === "YELLOW").length,
      GREEN: cases.filter((c) => c.priority === "GREEN").length,
      UNASSESSED: cases.filter((c) => c.priority === "UNASSESSED" || !c.priority).length,
    };

    return {
      total,
      awaitingTriage,
      inReview,
      highPriority,
      completed,
      avgWaitMinutes,
      priorityCounts,
    };
  }, [cases, nowTimestamp]);

  // Filtered & Sorted Cases
  const filteredCases = useMemo(() => {
    let result = [...cases];

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (c) =>
          c.patient_name?.toLowerCase().includes(q) ||
          String(c.id).includes(q) ||
          c.description?.toLowerCase().includes(q)
      );
    }

    // Priority filter
    if (priorityFilter !== "ALL") {
      result = result.filter((c) => c.priority === priorityFilter);
    }

    // Status filter
    if (statusFilter !== "ALL") {
      result = result.filter((c) => c.status === statusFilter);
    }

    // Assignment filter
    if (assignmentFilter === "MINE") {
      result = result.filter((c) => c.assigned_clinician === currentUser?.id);
    } else if (assignmentFilter === "UNASSIGNED") {
      result = result.filter((c) => !c.assigned_clinician);
    }

    // Sorting
    const priorityWeight = { RED: 1, YELLOW: 2, GREEN: 3, UNASSESSED: 4 };

    result.sort((a, b) => {
      if (sortBy === "priority") {
        const weightA = priorityWeight[a.priority] || 4;
        const weightB = priorityWeight[b.priority] || 4;
        if (weightA !== weightB) {
          return sortOrder === "asc" ? weightA - weightB : weightB - weightA;
        }
        // Tie-breaker: oldest arrival time first (deterministic queue order)
        return new Date(a.created_at) - new Date(b.created_at);
      }

      if (sortBy === "wait_time") {
        const timeA = new Date(a.created_at).getTime();
        const timeB = new Date(b.created_at).getTime();
        return sortOrder === "asc" ? timeA - timeB : timeB - timeA;
      }

      if (sortBy === "name") {
        return sortOrder === "asc"
          ? (a.patient_name || "").localeCompare(b.patient_name || "")
          : (b.patient_name || "").localeCompare(a.patient_name || "");
      }

      if (sortBy === "status") {
        return sortOrder === "asc"
          ? (a.status || "").localeCompare(b.status || "")
          : (b.status || "").localeCompare(a.status || "");
      }

      return 0;
    });

    return result;
  }, [cases, searchQuery, priorityFilter, statusFilter, assignmentFilter, sortBy, sortOrder, currentUser?.id]);

  // CSV Export Handler
  function exportQueueCSV() {
    const headers = [
      "Case ID",
      "Patient Name",
      "Priority",
      "Status",
      "Assigned Clinician ID",
      "Arrival Time",
      "Description",
    ];

    const rows = filteredCases.map((c) => [
      `CF-${c.id}`,
      `"${(c.patient_name || "").replace(/"/g, '""')}"`,
      c.priority || "UNASSESSED",
      c.status,
      c.assigned_clinician || "Unassigned",
      new Date(c.created_at).toISOString(),
      `"${(c.description || "").replace(/"/g, '""').replace(/\n/g, " ")}"`,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `careflow_patient_queue_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Arrival trend data by day
  const arrivalTrend = useMemo(() => {
    const map = {};
    cases.forEach((c) => {
      const day = new Date(c.created_at).toLocaleDateString([], { month: "short", day: "numeric" });
      map[day] = (map[day] || 0) + 1;
    });
    return Object.entries(map).slice(-7);
  }, [cases]);

  return (
    <div className="space-y-6">
      {/* Top Header & View Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Clinician Triage Operations</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Prioritized clinical queue with OpenAI GPT triage assistance and human review
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200">
            <button
              type="button"
              onClick={() => setActiveView("queue")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeView === "queue"
                  ? "bg-white text-teal-800 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Patient Queue ({filteredCases.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveView("overview")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeView === "overview"
                  ? "bg-white text-teal-800 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Clinical Overview
            </button>
          </div>

          {/* Refresh control */}
          <button
            type="button"
            onClick={() => onRefresh?.().then(() => setLastRefreshed(new Date()))}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-colors cursor-pointer"
            title="Refresh queue"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin text-teal-600" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* METRIC STATS CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Total In Queue
          </span>
          <p className="text-2xl font-bold text-slate-900 mt-1">{metrics.total}</p>
          <span className="text-[10px] text-slate-400">All registered cases</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider block">
            Awaiting Triage
          </span>
          <p className="text-2xl font-bold text-amber-700 mt-1">{metrics.awaitingTriage}</p>
          <span className="text-[10px] text-slate-400">Needs review</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-semibold text-sky-600 uppercase tracking-wider block">
            Under Review
          </span>
          <p className="text-2xl font-bold text-sky-700 mt-1">{metrics.inReview}</p>
          <span className="text-[10px] text-slate-400">Assigned / In Progress</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-rose-200 shadow-xs bg-rose-50/30">
          <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wider block flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            Immediate (Red)
          </span>
          <p className="text-2xl font-bold text-rose-800 mt-1">{metrics.highPriority}</p>
          <span className="text-[10px] text-rose-600 font-medium">Critical warning signs</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wider block">
            Completed
          </span>
          <p className="text-2xl font-bold text-emerald-700 mt-1">{metrics.completed}</p>
          <span className="text-[10px] text-slate-400">Reviewed & discharged</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Avg Wait Time
          </span>
          <p className="text-2xl font-bold text-slate-900 mt-1">
            {metrics.avgWaitMinutes > 0 ? `${metrics.avgWaitMinutes}m` : "< 5m"}
          </p>
          <span className="text-[10px] text-slate-400">Arrival to review</span>
        </div>
      </div>

      {archiveNotice && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-semibold flex items-center justify-between shadow-2xs">
          <span>{archiveNotice}</span>
          <button
            type="button"
            onClick={() => setArchiveNotice("")}
            className="text-emerald-700 hover:text-emerald-950 font-bold ml-2 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* VIEW 1: PATIENT QUEUE TABLE */}
      {activeView === "queue" && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          {/* Filters and Search Bar */}
          <div className="p-4 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
              {/* Search input */}
              <div className="relative flex-1 min-w-[200px] max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by patient, ID, or symptoms…"
                  className="w-full pl-9 pr-3.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                />
              </div>

              {/* Priority Filter */}
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none"
              >
                <option value="ALL">Priority: All</option>
                <option value="RED">Immediate (Red)</option>
                <option value="YELLOW">Prompt (Yellow)</option>
                <option value="GREEN">Routine (Green)</option>
                <option value="UNASSESSED">Unassessed</option>
              </select>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none"
              >
                <option value="ALL">Status: All</option>
                <option value="NEEDS_REVIEW">Needs Review</option>
                <option value="IN_REVIEW">In Review</option>
                <option value="NEEDS_INFORMATION">Needs Information</option>
                <option value="ESCALATED">Escalated</option>
                <option value="APPROVED">Completed</option>
              </select>

              {/* Clinician Assignment Filter */}
              <select
                value={assignmentFilter}
                onChange={(e) => setAssignmentFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none"
              >
                <option value="ALL">Assignment: All</option>
                <option value="MINE">Assigned to Me</option>
                <option value="UNASSIGNED">Unassigned Only</option>
              </select>
            </div>

            {/* Export & Sort Controls */}
            <div className="flex items-center gap-2">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none"
              >
                <option value="priority">Sort: Priority (Red First)</option>
                <option value="wait_time">Sort: Waiting Duration</option>
                <option value="name">Sort: Patient Name</option>
                <option value="status">Sort: Workflow Status</option>
              </select>

              <button
                type="button"
                onClick={() => setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
                className="p-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-slate-600 cursor-pointer"
                title={`Toggle order: currently ${sortOrder}`}
              >
                <ArrowUpDown className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={exportQueueCSV}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-xl transition-colors cursor-pointer"
                title="Export queue data to CSV"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Export CSV</span>
              </button>
            </div>
          </div>

          {/* Queue Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4">Case / Patient</th>
                  <th className="py-3 px-4">Arrival & Wait</th>
                  <th className="py-3 px-4">Chief Complaint / Symptoms</th>
                  <th className="py-3 px-4">Triage Priority</th>
                  <th className="py-3 px-4">Workflow Status</th>
                  <th className="py-3 px-4">Clinician</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCases.length > 0 ? (
                  filteredCases.map((item) => {
                    const isImmediate = item.priority === "RED";
                    const isAssigned = Boolean(item.assigned_clinician);
                    const isAssignedToMe = item.assigned_clinician === currentUser?.id;
                    const arrival = new Date(item.created_at);
                    const minutesWait = Math.floor((nowTimestamp - arrival.getTime()) / 60000);

                    return (
                      <tr
                        key={item.id}
                        onClick={() => onOpenCase(item)}
                        className={`hover:bg-slate-50/80 transition-colors cursor-pointer ${
                          isImmediate ? "bg-rose-50/30 font-medium" : ""
                        }`}
                      >
                        {/* Case & Patient Name */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            {isImmediate && (
                              <span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse shrink-0" />
                            )}
                            <div>
                              <span className="font-bold text-slate-900 block">
                                {item.patient_name}
                              </span>
                              <span className="text-[10px] font-mono text-slate-400">
                                CF-{item.id}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Arrival & Wait Duration */}
                        <td className="py-3.5 px-4 text-slate-600 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            <span>
                              {minutesWait < 60
                                ? `${minutesWait}m wait`
                                : `${Math.floor(minutesWait / 60)}h ${minutesWait % 60}m wait`}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400 block mt-0.5">
                            {arrival.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </td>

                        {/* Complaint & Symptoms */}
                        <td className="py-3.5 px-4 max-w-xs text-slate-700">
                          <p className="truncate font-medium">
                            {item.description || "No complaint specified"}
                          </p>
                        </td>

                        {/* Priority Badge */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <PriorityBadge value={item.priority} size="sm" />
                        </td>

                        {/* Status Badge */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <StatusBadge value={item.status} size="sm" />
                        </td>

                        {/* Clinician Assignment */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {isAssigned ? (
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium ${
                                isAssignedToMe
                                  ? "bg-teal-50 text-teal-800 border border-teal-200"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              <UserCheck className="w-3 h-3" />
                              <span>{isAssignedToMe ? "You" : `#${item.assigned_clinician}`}</span>
                            </span>
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">Unassigned</span>
                          )}
                        </td>

                        {/* Action Column */}
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenCase(item);
                              }}
                              className="inline-flex items-center gap-1 px-3 py-1 bg-white hover:bg-slate-100 active:bg-slate-200 border border-slate-200 text-slate-700 font-semibold rounded-lg text-xs transition-colors shadow-2xs cursor-pointer"
                            >
                              <span>Open</span>
                              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCaseToArchive(item);
                              }}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 rounded-lg transition-colors cursor-pointer"
                              title="Archive case"
                              aria-label="Archive case"
                            >
                              <Archive className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      <p className="text-sm font-semibold text-slate-600">No matching cases found in queue.</p>
                      <p className="text-xs text-slate-400 mt-1">Try adjusting your search or filters.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer info */}
          <div className="p-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 flex items-center justify-between">
            <span>Showing {filteredCases.length} of {cases.length} cases</span>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="rounded text-teal-600 focus:ring-teal-500"
                />
                <span className="text-[11px]">Auto-refresh (30s)</span>
              </label>
              <span className="text-slate-400">·</span>
              <span className="text-[11px]">
                Last updated: {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: CLINICAL OVERVIEW & CHARTS */}
      {activeView === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Priority Distribution Breakdown */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Triage Priority Distribution</h3>
                <p className="text-xs text-slate-500">Breakdown of active queue by urgency classification</p>
              </div>
              <PieChart className="w-5 h-5 text-teal-600" />
            </div>

            {/* Visual Priority Bars */}
            <div className="space-y-3 pt-2">
              <div>
                <div className="flex justify-between text-xs font-semibold mb-1">
                  <span className="text-rose-700 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-600" />
                    Immediate Review (Red)
                  </span>
                  <span className="text-slate-700">
                    {metrics.priorityCounts.RED} ({metrics.total > 0 ? Math.round((metrics.priorityCounts.RED / metrics.total) * 100) : 0}%)
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-rose-600 h-2.5 rounded-full transition-all duration-500"
                    style={{
                      width: `${metrics.total > 0 ? (metrics.priorityCounts.RED / metrics.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-semibold mb-1">
                  <span className="text-amber-700 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                    Prompt Review (Yellow)
                  </span>
                  <span className="text-slate-700">
                    {metrics.priorityCounts.YELLOW} ({metrics.total > 0 ? Math.round((metrics.priorityCounts.YELLOW / metrics.total) * 100) : 0}%)
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-amber-500 h-2.5 rounded-full transition-all duration-500"
                    style={{
                      width: `${metrics.total > 0 ? (metrics.priorityCounts.YELLOW / metrics.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-semibold mb-1">
                  <span className="text-emerald-700 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" />
                    Routine Care (Green)
                  </span>
                  <span className="text-slate-700">
                    {metrics.priorityCounts.GREEN} ({metrics.total > 0 ? Math.round((metrics.priorityCounts.GREEN / metrics.total) * 100) : 0}%)
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-emerald-600 h-2.5 rounded-full transition-all duration-500"
                    style={{
                      width: `${metrics.total > 0 ? (metrics.priorityCounts.GREEN / metrics.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-semibold mb-1">
                  <span className="text-slate-600 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
                    Unassessed / Pending AI
                  </span>
                  <span className="text-slate-700">
                    {metrics.priorityCounts.UNASSESSED} ({metrics.total > 0 ? Math.round((metrics.priorityCounts.UNASSESSED / metrics.total) * 100) : 0}%)
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-slate-400 h-2.5 rounded-full transition-all duration-500"
                    style={{
                      width: `${metrics.total > 0 ? (metrics.priorityCounts.UNASSESSED / metrics.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Patient Arrival Trend Chart */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Patient Arrival Trends</h3>
                <p className="text-xs text-slate-500">Case volume trend over recent days</p>
              </div>
              <TrendingUp className="w-5 h-5 text-teal-600" />
            </div>

            {arrivalTrend.length > 0 ? (
              <div className="pt-4 flex items-end justify-between gap-2 h-44 px-2">
                {arrivalTrend.map(([day, count]) => {
                  const maxCount = Math.max(...arrivalTrend.map(([, c]) => c), 1);
                  const heightPercent = Math.max(15, Math.round((count / maxCount) * 100));
                  return (
                    <div key={day} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                      <span className="text-[11px] font-bold text-slate-700">{count}</span>
                      <div
                        className="w-full max-w-[40px] bg-teal-500 hover:bg-teal-600 rounded-t-lg transition-all"
                        style={{ height: `${heightPercent}%` }}
                        title={`${count} cases on ${day}`}
                      />
                      <span className="text-[10px] text-slate-500 font-medium truncate w-full text-center">
                        {day}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-400 text-center py-12 italic">
                No historical arrival trends recorded yet.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Modal: Confirm Case Archival */}
      {caseToArchive && (
        <div className="fixed inset-0 z-60 bg-slate-900/50 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center border border-rose-200 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Archive Case CF-{caseToArchive.id}?</h3>
                <p className="text-xs text-slate-500">Patient: {caseToArchive.patient_name}</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-200">
              This case will be removed from the active triage queue. All clinical records, AI triage outputs, medical history, and audit logs will be permanently retained in compliance with healthcare data retention requirements.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setCaseToArchive(null)}
                disabled={archiving}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  setArchiving(true);
                  try {
                    await apiRequest(`/cases/${caseToArchive.id}/`, { method: "DELETE" });
                    setCaseToArchive(null);
                    setArchiveNotice(`Case CF-${caseToArchive.id} was successfully archived.`);
                    await onRefresh?.();
                  } catch (err) {
                    alert(err.message || "Failed to archive case.");
                  } finally {
                    setArchiving(false);
                  }
                }}
                disabled={archiving}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                {archiving ? "Archiving…" : "Confirm Archive"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
