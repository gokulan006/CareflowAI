import { useState } from "react";
import {
  Calendar,
  PlusCircle,
  Filter,
} from "lucide-react";
import { StatusBadge } from "./Badges";
import { apiRequest } from "../api";

export default function AppointmentsView({
  appointments = [],
  currentUser,
  onRefresh,
}) {
  const isClinician = currentUser?.role === "clinician";
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  // Patient Request Form state
  const [scheduledAt, setScheduledAt] = useState("");
  const [reason, setReason] = useState("");

  async function handleRequestAppointment(e) {
    e.preventDefault();
    if (!scheduledAt) {
      setError("Please select a date and time for your requested appointment.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest("/appointments/", {
        method: "POST",
        body: JSON.stringify({
          scheduled_at: new Date(scheduledAt).toISOString(),
          reason: reason.trim(),
        }),
      });
      setNotice("Appointment request submitted. The clinic team will review and confirm your slot.");
      setScheduledAt("");
      setReason("");
      onRefresh?.();
    } catch (err) {
      setError(err.message || "Failed to submit appointment request.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateAppointmentStatus(appointmentId, newStatus) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest(`/appointments/${appointmentId}/`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      setNotice(`Appointment status updated to ${newStatus.toLowerCase()}.`);
      onRefresh?.();
    } catch (err) {
      setError(err.message || "Failed to update appointment status.");
    } finally {
      setBusy(false);
    }
  }

  const filteredAppointments = appointments.filter((item) => {
    if (statusFilter === "ALL") return true;
    return item.status === statusFilter;
  });

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Top Banner */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {isClinician ? "Clinical Appointments Management" : "Your Appointments"}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {isClinician
              ? "Review, schedule, confirm, and update clinical consultations with patients"
              : "Request appointment consultations and track your scheduled care slots"}
          </p>
        </div>

        {/* Filter for Clinicians */}
        {isClinician && (
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none"
            >
              <option value="ALL">All Statuses</option>
              <option value="REQUESTED">Requested Only</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
        )}
      </div>

      {notice && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-medium flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} className="text-emerald-700 font-bold">✕</button>
        </div>
      )}
      {error && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-medium flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="text-rose-700 font-bold">✕</button>
        </div>
      )}

      {/* Patient: Request Form */}
      {!isClinician && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center gap-2">
            <PlusCircle className="w-5 h-5 text-teal-600" />
            <div>
              <h2 className="text-sm font-bold text-slate-900">Request an Appointment</h2>
              <p className="text-xs text-slate-500">Pick a preferred consultation date and describe your health reason</p>
            </div>
          </div>

          <form onSubmit={handleRequestAppointment} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Requested Date & Time <span className="text-rose-500">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Reason for Consultation
                </label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Follow up on dry cough or discuss lab results"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={busy || !scheduledAt}
                className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white font-semibold text-xs rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                {busy ? "Submitting Request…" : "Submit Appointment Request"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Appointments List */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-4 bg-white border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-900">
            {isClinician ? `Clinic Appointments (${filteredAppointments.length})` : "Your Scheduled Appointments"}
          </h2>
        </div>

        {filteredAppointments.length > 0 ? (
          <div className="divide-y divide-slate-100">
            {filteredAppointments.map((apt) => {
              const dt = new Date(apt.scheduled_at);
              return (
                <div
                  key={apt.id}
                  className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 hover:bg-slate-50/50 transition-colors"
                >
                  <div className="flex items-start gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-200 text-teal-700 flex flex-col items-center justify-center font-bold shrink-0">
                      <span className="text-[10px] leading-none uppercase">
                        {dt.toLocaleDateString([], { month: "short" })}
                      </span>
                      <span className="text-sm leading-none mt-0.5">{dt.getDate()}</span>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">
                          {dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="text-xs text-slate-500">
                          {dt.toLocaleDateString([], { weekday: "long", year: "numeric" })}
                        </span>
                      </div>
                      <p className="text-xs text-slate-700 font-medium">
                        {apt.reason || "General Medical Consultation"}
                      </p>
                      {isClinician && (
                        <p className="text-[11px] text-slate-500">
                          Patient #{apt.patient} {apt.clinician ? `· Assigned Clinician #${apt.clinician}` : "· Unassigned"}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <StatusBadge value={apt.status} />

                    {/* Clinician controls */}
                    {isClinician && (
                      <div className="flex items-center gap-1.5">
                        <select
                          value={apt.status}
                          onChange={(e) => handleUpdateAppointmentStatus(apt.id, e.target.value)}
                          disabled={busy}
                          className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 focus:outline-none"
                        >
                          <option value="REQUESTED">Requested</option>
                          <option value="CONFIRMED">Confirm</option>
                          <option value="COMPLETED">Complete</option>
                          <option value="CANCELLED">Cancel</option>
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-12 text-center text-slate-400 space-y-2">
            <Calendar className="w-10 h-10 text-slate-300 mx-auto" />
            <p className="text-sm font-semibold text-slate-600">No appointments found.</p>
            <p className="text-xs text-slate-400">
              {isClinician ? "No patient appointment requests match the current filter." : "You have no appointments booked yet."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
