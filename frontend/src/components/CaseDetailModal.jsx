import { useState, useEffect } from "react";
import {
  X,
  User,
  Clock,
  ShieldCheck,
  AlertTriangle,
  FileText,
  Download,
  CheckCircle2,
  RefreshCw,
  MessageSquare,
  Bot,
  Activity,
  History,
  Check,
  Edit3,
  Info,
  Archive,
  AlertCircle,
} from "lucide-react";
import { PriorityBadge, StatusBadge } from "./Badges";
import { apiRequest, downloadAttachment } from "../api";
import { validateClinicianReview, buildClinicianReviewPayload } from "../clinicianReview";

export default function CaseDetailModal({
  selectedCase,
  detail,
  currentUser,
  onClose,
  onUpdateCase,
  onRefresh,
}) {
  const [activeTab, setActiveTab] = useState("triage");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // Priority override modal state
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overridePriority, setOverridePriority] = useState("YELLOW");
  const [overrideRationale, setOverrideRationale] = useState("");

  // Chat history state
  const [chatMessages, setChatMessages] = useState([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [chatError, setChatError] = useState("");
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);

  const isAssignedToMe = selectedCase.assigned_clinician === currentUser.id;
  const isUnassigned = !selectedCase.assigned_clinician;
  const isFinalized = selectedCase.status === "APPROVED";

  // AI results
  const aiResult = detail?.aiResults?.[0] || null;
  const structuredOutput = aiResult?.structured_output || {};
  const suggestedPriority = structuredOutput.suggested_priority || "UNASSESSED";
  const priorityExplanation = structuredOutput.priority_explanation || "";
  const urgentAlerts = structuredOutput.urgent_alerts || [];
  const ruleTriggers = aiResult?.rule_triggers || [];
  const positiveFindings = structuredOutput.key_positive_findings || [];
  const negativeFindings = structuredOutput.important_negative_findings || [];
  const missingInfo = structuredOutput.missing_information || [];
  const contradictions = structuredOutput.contradictions || [];

  // Intake data
  const intake = detail?.intake || null;
  const attachments = detail?.attachments || [];
  const consent = detail?.consent || [];
  const activeConsent = consent.find((c) => c.granted && !c.withdrawn_at);

  // Latest review
  const reviews = detail?.clinicianReviews || [];
  const latestReview = [...reviews].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  )[0];

  // Activities
  const activities = detail?.activities || [];
  const [nowTimestamp] = useState(() => Date.now());

  useEffect(() => {
    let ignore = false;
    if (activeTab === "chat" && selectedCase?.id) {
      queueMicrotask(() => {
        if (!ignore) {
          setLoadingChat(true);
          setChatError("");
        }
      });
      apiRequest(`/cases/${selectedCase.id}/chat/`)
        .then((messages) => {
          if (!ignore) {
            setChatMessages(Array.isArray(messages) ? messages : []);
            setChatError("");
          }
        })
        .catch((e) => {
          console.warn("Could not load case chat:", e);
          if (!ignore) {
            setChatError(e.message || "Failed to load intake chat history.");
            setChatMessages([]);
          }
        })
        .finally(() => {
          if (!ignore) setLoadingChat(false);
        });
    }
    return () => {
      ignore = true;
    };
  }, [activeTab, selectedCase?.id]);

  async function handleArchiveCase() {
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/cases/${selectedCase.id}/`, {
        method: "DELETE",
      });
      setShowArchiveConfirm(false);
      onUpdateCase?.({ ...selectedCase, is_archived: true });
      onRefresh?.();
      onClose?.();
    } catch (e) {
      setError(e.message || "Failed to archive case.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAssignToMe() {
    setBusy(true);
    setError("");
    try {
      const updated = await apiRequest(`/cases/${selectedCase.id}/assign/`, {
        method: "PATCH",
        body: JSON.stringify({ clinician_id: currentUser.id }),
      });
      onUpdateCase?.(updated);
      setNotice("Case assigned to you.");
    } catch (e) {
      setError(e.message || "Could not assign case.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateStatus(newStatus) {
    setBusy(true);
    setError("");
    try {
      const updated = await apiRequest(`/cases/${selectedCase.id}/update_status/`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      onUpdateCase?.(updated);
      setNotice(`Case status changed to ${newStatus.replace("_", " ")}.`);
    } catch (e) {
      setError(e.message || "Failed to update status.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmAIPriority() {
    if (!suggestedPriority || suggestedPriority === "UNASSESSED") {
      setError("AI has not suggested a definitive priority for this case.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const updated = await apiRequest(`/cases/${selectedCase.id}/set-priority/`, {
        method: "POST",
        body: JSON.stringify({
          priority: suggestedPriority,
          rationale: priorityExplanation || "Confirmed AI triage recommendation.",
          is_override: false,
        }),
      });
      onUpdateCase?.(updated);
      setNotice(`Priority confirmed as ${suggestedPriority}.`);
    } catch (e) {
      setError(e.message || "Failed to confirm priority.");
    } finally {
      setBusy(false);
    }
  }

  async function handleOverridePrioritySubmit(e) {
    e.preventDefault();
    if (!overrideRationale.trim()) {
      setError("A clinical rationale is required when overriding the suggested priority.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const updated = await apiRequest(`/cases/${selectedCase.id}/set-priority/`, {
        method: "POST",
        body: JSON.stringify({
          priority: overridePriority,
          rationale: overrideRationale.trim(),
          is_override: true,
        }),
      });
      setShowOverrideModal(false);
      onUpdateCase?.(updated);
      setNotice(`Priority updated to ${overridePriority} with clinician rationale.`);
    } catch (e) {
      setError(e.message || "Failed to override priority.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReviewAction(formElement, workflowAction) {
    const formData = new FormData(formElement);
    const validationError = validateClinicianReview(formData, workflowAction);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (
      workflowAction === "finalize" &&
      !window.confirm(
        "Are you sure you want to finalize this clinical review? The patient comments and guidance will be published to the patient."
      )
    ) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const payload = buildClinicianReviewPayload(formData, workflowAction);
      const res = await apiRequest(`/cases/${selectedCase.id}/add_review/`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (res?.case_state) {
        onUpdateCase?.({ ...selectedCase, ...res.case_state });
      }
      setNotice(
        workflowAction === "finalize"
          ? "Clinical review finalized and published to patient."
          : workflowAction === "request_information"
          ? "Information requested from patient."
          : workflowAction === "escalate"
          ? "Case escalated and returned to handoff queue."
          : "Review draft saved successfully."
      );
      onRefresh?.();
    } catch (e) {
      setError(e.message || "Failed to save review action.");
    } finally {
      setBusy(false);
    }
  }

  // Calculate waiting time
  const arrivalDate = new Date(selectedCase.created_at);
  const diffMinutes = Math.floor((nowTimestamp - arrivalDate.getTime()) / (1000 * 60));
  const waitDurationText =
    diffMinutes < 60
      ? `${diffMinutes}m waiting`
      : `${Math.floor(diffMinutes / 60)}h ${diffMinutes % 60}m waiting`;

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-2 sm:p-4 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-200 max-w-5xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden my-4">
        {/* Workspace Header */}
        <div className="p-4 sm:p-6 bg-white border-b border-slate-200 shrink-0">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-md border border-teal-200">
                  CF-{selectedCase.id}
                </span>
                <span className="text-xs text-slate-400">·</span>
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {arrivalDate.toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {" "}({waitDurationText})
                </span>
              </div>
              <h1 className="text-xl font-bold text-slate-900">{selectedCase.patient_name}</h1>
              <p className="text-xs text-slate-600 mt-0.5 max-w-2xl line-clamp-1">
                {selectedCase.description || "No initial complaint recorded."}
              </p>
            </div>

            {/* Badges and Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <PriorityBadge value={selectedCase.priority} />
              <StatusBadge value={selectedCase.status} />

              {/* Assignment Badge / Action */}
              {isUnassigned ? (
                <button
                  type="button"
                  onClick={handleAssignToMe}
                  disabled={busy}
                  className="px-3 py-1 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg cursor-pointer"
                >
                  {busy ? "Assigning…" : "Assign to Me"}
                </button>
              ) : (
                <span className="px-2.5 py-1 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg border border-slate-200">
                  {isAssignedToMe ? "Assigned to You" : `Clinician #${selectedCase.assigned_clinician}`}
                </span>
              )}

              {/* Status transition dropdown for assigned clinician */}
              {isAssignedToMe && !isFinalized && (
                <select
                  value={selectedCase.status}
                  onChange={(e) => handleUpdateStatus(e.target.value)}
                  disabled={busy}
                  className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none"
                >
                  <option value="NEEDS_REVIEW">Status: Needs Review</option>
                  <option value="IN_REVIEW">Status: In Review</option>
                </select>
              )}

              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                aria-label="Close case detail"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Quick Priority Review & Confirmation Bar */}
          <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs bg-slate-50/70 p-2.5 rounded-xl">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-700">AI Suggested Priority:</span>
              <PriorityBadge value={suggestedPriority} size="sm" />
              {priorityExplanation && (
                <span className="text-slate-500 truncate max-w-md hidden md:inline">
                  — {priorityExplanation}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {isAssignedToMe && !isFinalized && (
                <>
                  {selectedCase.priority !== suggestedPriority && suggestedPriority !== "UNASSESSED" && (
                    <button
                      type="button"
                      onClick={handleConfirmAIPriority}
                      disabled={busy}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg shadow-2xs cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Confirm AI Priority</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowOverrideModal(true)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Override Priority</span>
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setShowArchiveConfirm(true)}
                disabled={busy}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer"
                title="Archive this case from active triage queue"
              >
                <Archive className="w-3.5 h-3.5" />
                <span>Archive Case</span>
              </button>
            </div>
          </div>
        </div>

        {/* Notices */}
        {notice && (
          <div className="px-6 py-2 bg-emerald-50 border-b border-emerald-200 text-emerald-800 text-xs font-medium flex items-center justify-between">
            <span>{notice}</span>
            <button onClick={() => setNotice("")} className="text-emerald-700 font-bold">✕</button>
          </div>
        )}
        {error && (
          <div className="px-6 py-2 bg-rose-50 border-b border-rose-200 text-rose-800 text-xs font-medium flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError("")} className="text-rose-700 font-bold">✕</button>
          </div>
        )}

        {/* Workspace Navigation Tabs */}
        <div className="px-6 border-b border-slate-200 bg-slate-50/50 flex space-x-6 shrink-0 text-sm font-semibold">
          <button
            onClick={() => setActiveTab("triage")}
            className={`py-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === "triage"
                ? "border-teal-600 text-teal-800"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>AI Triage & Findings</span>
          </button>
          <button
            onClick={() => setActiveTab("intake")}
            className={`py-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === "intake"
                ? "border-teal-600 text-teal-800"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Intake & History</span>
          </button>
          <button
            onClick={() => setActiveTab("chat")}
            className={`py-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === "chat"
                ? "border-teal-600 text-teal-800"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Intake Transcript</span>
          </button>
          <button
            onClick={() => setActiveTab("review")}
            className={`py-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === "review"
                ? "border-teal-600 text-teal-800"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Clinician Review & Actions</span>
          </button>
          <button
            onClick={() => setActiveTab("audit")}
            className={`py-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === "audit"
                ? "border-teal-600 text-teal-800"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <History className="w-4 h-4" />
            <span>Audit Trail</span>
          </button>
        </div>

        {/* Tab Body Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30">
          {/* TAB 1: AI TRIAGE & FINDINGS */}
          {activeTab === "triage" && (
            <div className="space-y-6">
              {/* Clinical Warning Alerts Banner if triggered */}
              {(urgentAlerts.length > 0 || ruleTriggers.length > 0) && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl space-y-2">
                  <div className="flex items-center gap-2 text-rose-800 font-bold text-sm">
                    <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
                    <span>Configured Clinical Warning Sign Detected</span>
                  </div>
                  <ul className="list-disc list-inside text-xs text-rose-900 space-y-1">
                    {urgentAlerts.map((ua, idx) => (
                      <li key={idx}>
                        <strong>{ua.alert || ua}</strong>
                        {ua.evidence && <span className="opacity-90"> — Evidence: {ua.evidence}</span>}
                      </li>
                    ))}
                    {ruleTriggers.map((rt, idx) => (
                      <li key={`rule-${idx}`}>
                        <span>Rule Trigger: {rt.name || rt.rule_id}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Priority Recommendation Card */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <span>Advisory Triage Recommendation</span>
                    <span className="text-[10px] text-slate-400 font-normal">
                      (Model: {aiResult?.model_name || "gpt-4o-mini"})
                    </span>
                  </h3>
                  <PriorityBadge value={suggestedPriority} />
                </div>
                <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 p-3.5 rounded-lg border border-slate-200/80">
                  {priorityExplanation || "No explanatory rationale returned by AI triage pipeline."}
                </p>
                <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
                  <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
                  <span>
                    Advisory triage recommendation generated from patient-reported symptoms. Does not replace clinician evaluation.
                  </span>
                </div>
              </div>

              {/* Key Findings Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    Key Positive Findings
                  </h4>
                  {positiveFindings.length > 0 ? (
                    <ul className="space-y-1.5 text-xs text-slate-700">
                      {positiveFindings.map((f, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="text-slate-400">•</span>
                          <span>{typeof f === "object" ? f.finding || JSON.stringify(f) : f}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-slate-400 italic">No positive findings noted.</p>
                  )}
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-slate-400" />
                    Important Negative Findings
                  </h4>
                  {negativeFindings.length > 0 ? (
                    <ul className="space-y-1.5 text-xs text-slate-700">
                      {negativeFindings.map((f, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="text-slate-400">•</span>
                          <span>{typeof f === "object" ? f.finding || JSON.stringify(f) : f}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-slate-400 italic">None reported.</p>
                  )}
                </div>
              </div>

              {/* Missing or Unclear Info */}
              {(missingInfo.length > 0 || contradictions.length > 0) && (
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 text-amber-500" />
                    Missing or Unclear Information to Clarify
                  </h4>
                  <ul className="space-y-1.5 text-xs text-slate-700">
                    {missingInfo.map((m, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="text-amber-500 font-bold">•</span>
                        <span>
                          <strong>{m.item || "Information"}:</strong> {m.reason || ""}
                        </span>
                      </li>
                    ))}
                    {contradictions.map((c, i) => (
                      <li key={`c-${i}`} className="flex items-start gap-1.5 text-rose-700">
                        <span className="font-bold">• Contradiction:</span>
                        <span>{typeof c === "object" ? JSON.stringify(c) : c}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: INTAKE & CLINICAL HISTORY */}
          {activeTab === "intake" && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
                <h3 className="text-sm font-bold text-slate-900 mb-4 border-b border-slate-100 pb-2">
                  Patient-Reported Structured Intake
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="font-semibold text-slate-500 block mb-1">Chief Complaint / Initial Description</span>
                    <p className="p-2.5 bg-slate-50 rounded-lg text-slate-800 border border-slate-100">
                      {selectedCase.description || "Not provided"}
                    </p>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-500 block mb-1">Reported Symptoms</span>
                    <p className="p-2.5 bg-slate-50 rounded-lg text-slate-800 border border-slate-100">
                      {intake?.symptoms?.length
                        ? intake.symptoms.join(", ")
                        : "No structured symptoms listed"}
                    </p>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-500 block mb-1">Onset & Duration</span>
                    <p className="p-2.5 bg-slate-50 rounded-lg text-slate-800 border border-slate-100">
                      Onset: {intake?.symptom_onset || "Not specified"} · Duration: {intake?.duration || "Not specified"}
                    </p>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-500 block mb-1">Severity & Progression</span>
                    <p className="p-2.5 bg-slate-50 rounded-lg text-slate-800 border border-slate-100">
                      Severity: {intake?.severity_description || "Not specified"} · Progression: {intake?.progression || "Not specified"}
                    </p>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-500 block mb-1">Medical History</span>
                    <p className="p-2.5 bg-slate-50 rounded-lg text-slate-800 border border-slate-100">
                      {intake?.medical_history || "No prior history reported"}
                    </p>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-500 block mb-1">Current Medications</span>
                    <p className="p-2.5 bg-slate-50 rounded-lg text-slate-800 border border-slate-100">
                      {intake?.current_medications || "None reported"}
                    </p>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-500 block mb-1">Allergies</span>
                    <p className="p-2.5 bg-slate-50 rounded-lg text-slate-800 border border-slate-100">
                      {intake?.allergies || "No allergies reported"}
                    </p>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-500 block mb-1">Additional Patient Notes</span>
                    <p className="p-2.5 bg-slate-50 rounded-lg text-slate-800 border border-slate-100">
                      {intake?.additional_information || "None provided"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Uploaded Attachments */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
                <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center justify-between">
                  <span>Attached Medical Reports ({attachments.length})</span>
                  <span className="text-xs font-normal text-slate-400">PDF, PNG, JPEG</span>
                </h3>
                {attachments.length > 0 ? (
                  <div className="space-y-2">
                    {attachments.map((att) => (
                      <div
                        key={att.id}
                        className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-teal-600" />
                          <span className="font-semibold text-slate-800">{att.original_filename}</span>
                          <span className="text-slate-400">
                            ({Math.round((att.size_bytes || 0) / 1024)} KB)
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => downloadAttachment(att.id, att.original_filename)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 rounded-md transition-colors cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download Report</span>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">No medical documents or reports attached for this case.</p>
                )}
              </div>

              {/* Consent Records */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <ShieldCheck className={`w-4 h-4 ${activeConsent ? "text-emerald-600" : "text-amber-500"}`} />
                  <span className="font-semibold text-slate-800">
                    Patient Consent Status: {activeConsent ? "Active & Granted" : "Withdrawn / None"}
                  </span>
                </div>
                {activeConsent && (
                  <span className="text-slate-500">
                    Granted: {new Date(activeConsent.granted_at || activeConsent.created_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: INTAKE CHAT TRANSCRIPT */}
          {activeTab === "chat" && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
                <h3 className="text-sm font-bold text-slate-900 mb-2">Verbatim Intake Chat History</h3>
                <p className="text-xs text-slate-500">
                  Review the conversational transcript between the patient and CareFlow AI during intake.
                </p>
              </div>

              {loadingChat ? (
                <div className="py-12 text-center text-xs text-slate-500 bg-white rounded-xl border border-slate-200">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-teal-600" />
                  <span>Loading intake chat transcript…</span>
                </div>
              ) : chatError ? (
                <div className="p-6 bg-white border border-rose-200 rounded-xl text-center space-y-3">
                  <AlertCircle className="w-6 h-6 text-rose-600 mx-auto" />
                  <p className="text-xs font-semibold text-rose-900">{chatError}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setLoadingChat(true);
                      setChatError("");
                      apiRequest(`/cases/${selectedCase.id}/chat/`)
                        .then((messages) => {
                          setChatMessages(Array.isArray(messages) ? messages : []);
                          setChatError("");
                        })
                        .catch((e) => {
                          setChatError(e.message || "Failed to load chat history.");
                        })
                        .finally(() => setLoadingChat(false));
                    }}
                    className="px-3.5 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg cursor-pointer"
                  >
                    Retry Loading Transcript
                  </button>
                </div>
              ) : chatMessages.length > 0 ? (
                <div className="space-y-3">
                  {chatMessages.map((m, idx) => {
                    const isAssistant = m.role === "assistant";
                    return (
                      <div
                        key={idx}
                        className={`flex gap-3 max-w-2xl ${
                          isAssistant ? "mr-auto" : "ml-auto flex-row-reverse"
                        }`}
                      >
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold ${
                            isAssistant
                              ? "bg-teal-600 text-white"
                              : "bg-slate-200 text-slate-700"
                          }`}
                        >
                          {isAssistant ? <Bot className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-semibold text-slate-500">
                              {isAssistant ? "CareFlow AI" : selectedCase.patient_name}
                            </span>
                            {m.created_at && (
                              <span className="text-[9px] text-slate-400">
                                {new Date(m.created_at).toLocaleString([], {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            )}
                          </div>
                          <div
                            className={`p-3 rounded-xl text-xs leading-relaxed shadow-2xs whitespace-pre-wrap ${
                              isAssistant
                                ? "bg-white border border-slate-200 text-slate-800"
                                : "bg-teal-600 text-white"
                            }`}
                          >
                            {m.content}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-12 text-slate-400 space-y-2 bg-white rounded-xl border border-slate-200 p-6">
                  <Bot className="w-8 h-8 text-slate-300 mx-auto" />
                  <p className="text-xs font-semibold text-slate-700">No conversational chat messages recorded for this case.</p>
                  <p className="text-[11px] text-slate-400">Intake information was entered directly or has not started conversational chat triage.</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: CLINICIAN REVIEW & ACTIONS */}
          {activeTab === "review" && (
            <div className="space-y-6">
              {/* Existing review state if finalized */}
              {latestReview?.is_finalized && (
                <div className="bg-emerald-50/80 border border-emerald-200 p-4 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      Finalized Clinical Review
                    </span>
                    <span className="text-[11px] text-emerald-800">
                      Approved: {new Date(latestReview.approved_at || latestReview.created_at).toLocaleString()}
                    </span>
                  </div>
                  {latestReview.patient_comments && (
                    <p className="text-xs text-emerald-950 bg-white/80 p-2.5 rounded-lg border border-emerald-100">
                      <strong>Patient Instructions:</strong> {latestReview.patient_comments}
                    </p>
                  )}
                  {latestReview.reviewer_comments && (
                    <p className="text-xs text-slate-700 bg-white/80 p-2.5 rounded-lg border border-emerald-100">
                      <strong>Internal Notes:</strong> {latestReview.reviewer_comments}
                    </p>
                  )}
                </div>
              )}

              {/* Review Workspace Form */}
              {!isAssignedToMe ? (
                <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
                  <User className="w-10 h-10 text-slate-400 mx-auto mb-2" />
                  <h4 className="text-sm font-bold text-slate-800">Case Unassigned to You</h4>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">
                    Assign this case to yourself before recording clinical notes, requesting patient info, or finalizing review decisions.
                  </p>
                  <button
                    type="button"
                    onClick={handleAssignToMe}
                    disabled={busy}
                    className="px-4 py-2 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-xl"
                  >
                    Assign Case to Me
                  </button>
                </div>
              ) : isFinalized ? (
                <div className="p-4 bg-slate-100 border border-slate-200 rounded-xl text-center text-xs text-slate-600">
                  This clinical review is finalized and locked.
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleReviewAction(e.currentTarget, "save_draft");
                  }}
                  className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-bold text-slate-900">Clinical Review & Decision</h3>
                    <span className="text-xs text-slate-500">Draft your clinical evaluation</span>
                  </div>

                  {/* Decision */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                      Review Status Decision
                    </label>
                    <select
                      name="decision"
                      defaultValue={latestReview?.decision || "IN_REVIEW"}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                    >
                      <option value="IN_REVIEW">In Progress (Clinical Review Ongoing)</option>
                      <option value="APPROVED">Completed / Reviewed (Ready to Finalize)</option>
                    </select>
                  </div>

                  {/* Internal Clinician Notes */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                      Internal Clinician Notes <span className="font-normal text-slate-400 lowercase">(confidential to clinical team)</span>
                    </label>
                    <textarea
                      name="comments"
                      rows={3}
                      defaultValue={latestReview?.reviewer_comments || ""}
                      placeholder="Differential notes, reasoning, or clinical findings private to medical staff…"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                    />
                  </div>

                  {/* Comments for Patient */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                      Comments / Recommendations for Patient <span className="text-rose-500">*</span>
                    </label>
                    <textarea
                      name="patient_comments"
                      rows={3}
                      defaultValue={latestReview?.patient_comments || ""}
                      placeholder="Clear explanation of triage assessment, care instructions, or home monitoring…"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                        Follow-Up Instructions
                      </label>
                      <textarea
                        name="follow_up"
                        rows={2}
                        defaultValue={latestReview?.follow_up_instructions || ""}
                        placeholder="e.g. Schedule appointment if fever exceeds 101F for 48 hrs"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                        Referral Details
                      </label>
                      <textarea
                        name="referral"
                        rows={2}
                        defaultValue={latestReview?.referral_details || ""}
                        placeholder="e.g. Referred to outpatient ENT specialist"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                      />
                    </div>
                  </div>

                  {/* Additional Actions: Request Info & Escalation */}
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                      Workflow Specific Fields
                    </h4>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Information Request for Patient <span className="text-slate-400">(Required when clicking "Request Info")</span>
                      </label>
                      <input
                        type="text"
                        name="patient_request"
                        defaultValue={latestReview?.patient_request || ""}
                        placeholder="Specific question or vital sign needed from patient…"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Escalation Reason <span className="text-slate-400">(Required when clicking "Escalate Case")</span>
                      </label>
                      <input
                        type="text"
                        name="escalation_reason"
                        defaultValue={latestReview?.escalation_reason || ""}
                        placeholder="Clinical rationale for handoff to emergency department or specialist…"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                      />
                    </div>
                  </div>

                  {/* Actions buttons */}
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
                    <button
                      type="submit"
                      disabled={busy}
                      className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
                    >
                      Save Draft
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(e) => handleReviewAction(e.currentTarget.form, "request_information")}
                      className="px-4 py-2 text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-xl cursor-pointer"
                    >
                      Request Info
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(e) => handleReviewAction(e.currentTarget.form, "escalate")}
                      className="px-4 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl cursor-pointer"
                    >
                      Escalate Case
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(e) => handleReviewAction(e.currentTarget.form, "finalize")}
                      className="px-5 py-2 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-xl shadow-xs cursor-pointer"
                    >
                      Finalize Review
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* TAB 5: AUDIT TRAIL */}
          {activeTab === "audit" && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
              <h3 className="text-sm font-bold text-slate-900 mb-4 border-b border-slate-100 pb-2">
                Case Activity & Clinical Audit Trail
              </h3>
              {activities.length > 0 ? (
                <div className="relative pl-6 border-l-2 border-slate-200 space-y-4">
                  {[...activities]
                    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                    .map((act) => (
                      <div key={act.id} className="relative">
                        <div className="absolute -left-[31px] top-1 w-3 h-3 rounded-full bg-teal-600 border-2 border-white ring-2 ring-teal-100" />
                        <div className="text-xs">
                          <span className="font-bold text-slate-800">
                            {act.action.replaceAll("_", " ")}
                          </span>
                          <span className="text-slate-400 ml-2">by {act.actor_name || "System"}</span>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {new Date(act.timestamp).toLocaleString()}
                          </p>
                          {(act.old_status || act.new_status) && (
                            <p className="text-[11px] text-slate-600 mt-1 font-mono bg-slate-50 px-2 py-0.5 rounded-md inline-block">
                              {act.old_status || "None"} → {act.new_status}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">No activity recorded for this case.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal: Priority Override */}
      {showOverrideModal && (
        <div className="fixed inset-0 bg-slate-900/60 z-60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-base font-bold text-slate-900 mb-1">Override Triage Priority</h3>
            <p className="text-xs text-slate-500 mb-4">
              Select a revised priority category and record a mandatory clinical justification for the audit trail.
            </p>

            <form onSubmit={handleOverridePrioritySubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Assigned Priority
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {["RED", "YELLOW", "GREEN"].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setOverridePriority(p)}
                      className={`py-2 px-3 text-xs font-bold rounded-xl border text-center transition-all cursor-pointer ${
                        overridePriority === p
                          ? p === "RED"
                            ? "bg-rose-50 border-rose-500 text-rose-800 ring-2 ring-rose-500/20"
                            : p === "YELLOW"
                            ? "bg-amber-50 border-amber-500 text-amber-800 ring-2 ring-amber-500/20"
                            : "bg-emerald-50 border-emerald-500 text-emerald-800 ring-2 ring-emerald-500/20"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {p === "RED" ? "Immediate" : p === "YELLOW" ? "Prompt" : "Routine"}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Clinical Rationale <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={overrideRationale}
                  onChange={(e) => setOverrideRationale(e.target.value)}
                  rows={3}
                  required
                  placeholder="Explain why clinical judgment overrides the initial recommendation…"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowOverrideModal(false)}
                  className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-xl shadow-xs"
                >
                  Save Override
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Archive Case Confirmation Dialog */}
      {showArchiveConfirm && (
        <div className="fixed inset-0 z-60 bg-slate-900/50 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center border border-rose-200 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Archive Case CF-{selectedCase.id}?</h3>
                <p className="text-xs text-slate-500">Patient: {selectedCase.patient_name}</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-200">
              This case will be removed from the active triage queue. All clinical notes, patient intake data, attachments, and audit history will be permanently preserved in compliance with medical data safety standards.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowArchiveConfirm(false)}
                disabled={busy}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleArchiveCase}
                disabled={busy}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                {busy ? "Archiving…" : "Confirm Archive"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
