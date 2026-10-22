import { useState } from "react";
import {
  MessageSquareHeart,
  MessageSquare,
  Calendar,
  ClipboardList,
  AlertTriangle,
  CheckCircle2,
  Phone,
  ChevronRight,
  ShieldCheck,
  PlusCircle,
  Archive,
} from "lucide-react";
import { StatusBadge, PriorityBadge } from "./Badges";
import { apiRequest } from "../api";

export default function PatientDashboard({
  user,
  cases = [],
  appointments = [],
  onStartIntake,
  onOpenIntakeChat,
  onOpenCase,
  onOpenAppointments,
  onRefresh,
}) {
  const [caseToArchive, setCaseToArchive] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const [archiveNotice, setArchiveNotice] = useState("");

  const pendingCount = cases.filter((c) => c.status === "NEEDS_REVIEW").length;
  const inReviewCount = cases.filter((c) => c.status === "IN_REVIEW").length;
  const completedCount = cases.filter((c) => c.status === "APPROVED").length;
  const upcomingAppointments = appointments.filter(
    (a) => a.status === "REQUESTED" || a.status === "CONFIRMED"
  );

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="bg-linear-to-r from-teal-700 via-teal-600 to-sky-700 rounded-2xl p-6 sm:p-8 text-white shadow-md relative overflow-hidden">
        <div className="max-w-2xl relative z-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-white/20 text-white backdrop-blur-xs mb-3">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Secure Patient Care Portal</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Welcome, {user?.full_name || user?.username}
          </h1>
          <p className="text-teal-100 text-sm mt-2 leading-relaxed">
            Report your symptoms through our conversational AI assistant. Your responses and medical history are reviewed directly by your clinical care team.
          </p>
          <div className="flex flex-wrap gap-3 mt-6">
            <button
              type="button"
              onClick={onStartIntake}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-teal-800 hover:bg-teal-50 active:bg-teal-100 font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer"
            >
              <MessageSquareHeart className="w-4 h-4 text-teal-600" />
              <span>Start New AI Intake</span>
            </button>
            <button
              type="button"
              onClick={onOpenAppointments}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-teal-800/60 hover:bg-teal-800/80 text-white font-semibold text-xs rounded-xl border border-white/20 transition-all cursor-pointer"
            >
              <Calendar className="w-4 h-4" />
              <span>Book Appointment</span>
            </button>
          </div>
        </div>

        {/* Decorative background circle */}
        <div className="absolute right-0 top-0 translate-x-12 -translate-y-12 w-96 h-96 bg-white/10 rounded-full blur-2xl pointer-events-none" />
      </div>

      {/* Emergency Alert Banner */}
      <div className="p-4 bg-amber-50 border border-amber-200/80 rounded-xl flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-900 leading-relaxed">
          <strong className="font-semibold block mb-0.5">When to Seek Emergency Care</strong>
          If you are experiencing acute chest pressure, serious difficulty breathing, slurred speech, sudden weakness, or heavy bleeding, do not wait for online intake review. Dial <strong>911</strong> or go to your nearest emergency facility immediately.
        </div>
      </div>

      {/* Archive Notice Banner */}
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

      {/* Overview Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Submitted Intakes
          </span>
          <p className="text-2xl font-bold text-slate-900 mt-1">{cases.length}</p>
          <span className="text-[10px] text-slate-400">Total health reports</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider block">
            Awaiting Review
          </span>
          <p className="text-2xl font-bold text-amber-700 mt-1">{pendingCount}</p>
          <span className="text-[10px] text-slate-400">In clinician queue</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-semibold text-sky-600 uppercase tracking-wider block">
            Under Review
          </span>
          <p className="text-2xl font-bold text-sky-700 mt-1">{inReviewCount}</p>
          <span className="text-[10px] text-slate-400">Assigned to clinician</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wider block">
            Completed Care
          </span>
          <p className="text-2xl font-bold text-emerald-700 mt-1">{completedCount}</p>
          <span className="text-[10px] text-slate-400">Guidance published</span>
        </div>
      </div>

      {/* Grid: Cases & Appointments */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Recent Intakes (2 cols) */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Your Submitted Intakes</h2>
              <p className="text-xs text-slate-500">Track status and review outcomes from your care team</p>
            </div>
            <button
              type="button"
              onClick={onStartIntake}
              className="text-xs font-semibold text-teal-700 hover:text-teal-800 cursor-pointer flex items-center gap-1"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>New Intake</span>
            </button>
          </div>

          {cases.length > 0 ? (
            <div className="space-y-3">
              {cases.map((item) => (
                <div
                  key={item.id}
                  onClick={() => onOpenCase?.(item)}
                  className="p-4 bg-slate-50/70 hover:bg-slate-50 border border-slate-200/80 rounded-xl transition-all cursor-pointer flex items-center justify-between gap-4"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-teal-700">CF-{item.id}</span>
                      <span className="text-xs text-slate-400">·</span>
                      <span className="text-xs text-slate-500">
                        {new Date(item.created_at).toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {item.description || "General Intake Session"}
                    </p>
                    <p className="text-xs text-slate-500">
                      Patient: {item.patient_name}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <PriorityBadge value={item.priority} size="sm" />
                    <StatusBadge value={item.status} size="sm" />
                    {onOpenIntakeChat && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenIntakeChat?.(item);
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors cursor-pointer"
                        title="Open Intake AI Chat for this case"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">AI Chat</span>
                      </button>
                    )}
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
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-slate-500 space-y-3">
              <ClipboardList className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="text-sm font-medium">No symptom intakes submitted yet.</p>
              <button
                type="button"
                onClick={onStartIntake}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs rounded-xl shadow-xs"
              >
                Start Your First Intake
              </button>
            </div>
          )}
        </div>

        {/* Right Column: Next Steps & Appointments (1 col) */}
        <div className="space-y-6">
          {/* Upcoming Appointments Widget */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-teal-600" />
                <span>Appointments</span>
              </h2>
              <button
                type="button"
                onClick={onOpenAppointments}
                className="text-xs font-semibold text-teal-700 hover:text-teal-800 cursor-pointer"
              >
                Manage
              </button>
            </div>

            {upcomingAppointments.length > 0 ? (
              <div className="space-y-3">
                {upcomingAppointments.slice(0, 3).map((apt) => (
                  <div key={apt.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-800">
                        {new Date(apt.scheduled_at).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <StatusBadge value={apt.status} size="sm" />
                    </div>
                    <p className="text-slate-500 line-clamp-1">{apt.reason || "General Consultation"}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-slate-400 text-xs">
                <p>No upcoming appointments scheduled.</p>
                <button
                  type="button"
                  onClick={onOpenAppointments}
                  className="mt-2 text-teal-700 font-semibold underline"
                >
                  Request an appointment
                </button>
              </div>
            )}
          </div>

          {/* What to do next Card */}
          <div className="bg-slate-50/80 rounded-2xl border border-slate-200/80 p-5 space-y-3 text-xs text-slate-600">
            <h3 className="font-bold text-slate-900 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-teal-600" />
              <span>What Happens After You Submit?</span>
            </h3>
            <ol className="list-decimal list-inside space-y-2 text-slate-600 leading-relaxed">
              <li>
                <strong>AI Intake Processing:</strong> CareFlow AI structures your answers and prepares an advisory triage report.
              </li>
              <li>
                <strong>Clinician Review:</strong> A licensed clinician evaluates your case, confirms priority, and reviews attachments.
              </li>
              <li>
                <strong>Care Instructions:</strong> Once finalized, your clinician's guidance, next steps, and referral instructions will appear directly in your intake details.
              </li>
            </ol>
          </div>

          {/* Clinic Contact card */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 text-xs text-slate-600 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700 shrink-0">
              <Phone className="w-4 h-4" />
            </div>
            <div>
              <p className="font-semibold text-slate-800">Need Clinical Support?</p>
              <p className="text-slate-500">Clinic Reception: (555) 019-2834</p>
            </div>
          </div>
        </div>
      </div>

      {/* Modal: Confirm Patient Case Archival */}
      {caseToArchive && (
        <div className="fixed inset-0 z-60 bg-slate-900/50 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center border border-rose-200 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Archive Case CF-{caseToArchive.id}?</h3>
                <p className="text-xs text-slate-500">{caseToArchive.description || caseToArchive.patient_name}</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-200">
              Are you sure you want to archive this intake case? Your submitted symptoms, medical history, and clinical review records will be preserved safely.
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
                    setArchiveNotice(`Case CF-${caseToArchive.id} was archived.`);
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
