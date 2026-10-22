import { useState, useEffect } from "react";
import {
  X,
  Clock,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  FileText,
  Download,
  Bot,
  Sparkles,
  MessageSquare,
  Archive,
  RefreshCw,
  User,
} from "lucide-react";
import { StatusBadge, PriorityBadge } from "./Badges";
import { downloadAttachment, apiRequest } from "../api";

export default function PatientCaseDetailModal({
  selectedCase,
  detail,
  onClose,
  onUpdateCase,
  onRefresh,
  onOpenChat,
}) {
  const [activeTab, setActiveTab] = useState("overview");
  const [loadingChat, setLoadingChat] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatError, setChatError] = useState("");

  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState("");

  const intake = detail?.intake || null;
  const attachments = detail?.attachments || [];
  const patientReview = detail?.patientReview || null;
  const patientAI = detail?.patientAI || null;

  const savedReview = patientReview?.status === "completed" ? patientReview.review : null;
  const requestedInfo = patientReview?.request || null;
  const aiSuggestions = patientAI?.status === "completed" ? patientAI.result?.suggestions : null;

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
    setArchiving(true);
    setArchiveError("");
    try {
      await apiRequest(`/cases/${selectedCase.id}/`, {
        method: "DELETE",
      });
      setShowArchiveConfirm(false);
      onUpdateCase?.({ ...selectedCase, is_archived: true });
      onRefresh?.();
      onClose?.();
    } catch (e) {
      setArchiveError(e.message || "Failed to archive case.");
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-200 max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden my-4">
        {/* Header */}
        <div className="p-5 sm:p-6 bg-white border-b border-slate-200 shrink-0 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-md border border-teal-200">
                CF-{selectedCase.id}
              </span>
              <span className="text-xs text-slate-400">·</span>
              <span className="text-xs text-slate-500">
                Submitted {new Date(selectedCase.created_at).toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            </div>
            <h2 className="text-xl font-bold text-slate-900">{selectedCase.patient_name}</h2>
            <p className="text-xs text-slate-600 mt-0.5">{selectedCase.description || "General Intake"}</p>
          </div>

          <div className="flex items-center gap-2">
            <PriorityBadge value={selectedCase.priority} />
            <StatusBadge value={selectedCase.status} />
            {onOpenChat && (
              <button
                type="button"
                onClick={() => onOpenChat?.(selectedCase)}
                className="px-2.5 py-1.5 text-xs font-semibold text-teal-700 hover:text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
                title="Continue in AI Intake Chat"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Intake Chat</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowArchiveConfirm(true)}
              className="px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:text-rose-900 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
              title="Archive this case"
            >
              <Archive className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Archive</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {archiveError && (
          <div className="px-6 py-2.5 bg-rose-50 border-b border-rose-200 text-xs text-rose-800 flex items-center justify-between">
            <span>{archiveError}</span>
            <button
              type="button"
              onClick={() => setArchiveError("")}
              className="text-rose-700 hover:text-rose-950 font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="px-6 border-b border-slate-200 bg-slate-50/50 flex space-x-6 shrink-0 text-sm font-semibold overflow-x-auto">
          <button
            onClick={() => setActiveTab("overview")}
            className={`py-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === "overview"
                ? "border-teal-600 text-teal-800"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Clinical Review & Status</span>
          </button>
          <button
            onClick={() => setActiveTab("intake")}
            className={`py-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === "intake"
                ? "border-teal-600 text-teal-800"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>My Reported Symptoms</span>
          </button>
          <button
            onClick={() => setActiveTab("chat")}
            className={`py-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === "chat"
                ? "border-teal-600 text-teal-800"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Intake Chat</span>
          </button>
          <button
            onClick={() => setActiveTab("ai")}
            className={`py-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === "ai"
                ? "border-teal-600 text-teal-800"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <Bot className="w-4 h-4" />
            <span>Advisory AI Summary</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/30">
          {/* TAB 1: CLINICAL REVIEW & STATUS */}
          {activeTab === "overview" && (
            <div className="space-y-4">
              {/* Information Requested Alert */}
              {requestedInfo && (
                <div className="p-4 bg-purple-50 border border-purple-200 rounded-xl space-y-1.5">
                  <div className="flex items-center gap-2 text-purple-900 font-bold text-sm">
                    <AlertCircle className="w-5 h-5 text-purple-600 shrink-0" />
                    <span>Clinician Request for More Information</span>
                  </div>
                  <p className="text-xs text-purple-950 bg-white/80 p-3 rounded-lg border border-purple-100 leading-relaxed">
                    {requestedInfo}
                  </p>
                  <p className="text-[11px] text-purple-700">
                    Please use the AI Intake Chat or contact the clinic to answer your clinician's question.
                  </p>
                </div>
              )}

              {/* Finalized Review */}
              {savedReview ? (
                <div className="bg-white rounded-xl border border-emerald-200 p-5 shadow-xs space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
                        ✓
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">Clinician Guidance</h3>
                        <p className="text-[11px] text-slate-500">
                          Reviewed {new Date(savedReview.approved_at || savedReview.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full">
                      Reviewed by Care Team
                    </span>
                  </div>

                  {savedReview.patient_comments && (
                    <div>
                      <span className="text-xs font-semibold text-slate-700 block mb-1">
                        Clinician Notes & Care Recommendations:
                      </span>
                      <p className="text-xs text-slate-800 bg-slate-50 p-3.5 rounded-lg border border-slate-200/80 leading-relaxed whitespace-pre-wrap">
                        {savedReview.patient_comments}
                      </p>
                    </div>
                  )}

                  {savedReview.follow_up_instructions && (
                    <div>
                      <span className="text-xs font-semibold text-slate-700 block mb-1">
                        Follow-Up Guidance:
                      </span>
                      <p className="text-xs text-slate-800 bg-slate-50 p-3 rounded-lg border border-slate-200/80 leading-relaxed">
                        {savedReview.follow_up_instructions}
                      </p>
                    </div>
                  )}

                  {savedReview.referral_details && (
                    <div>
                      <span className="text-xs font-semibold text-slate-700 block mb-1">
                        Specialist Referrals:
                      </span>
                      <p className="text-xs text-slate-800 bg-slate-50 p-3 rounded-lg border border-slate-200/80 leading-relaxed">
                        {savedReview.referral_details}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs text-center space-y-2">
                  <Clock className="w-10 h-10 text-teal-600 mx-auto" />
                  <h3 className="text-base font-bold text-slate-800">Review In Progress</h3>
                  <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                    Your reported symptoms have been saved and assigned to our clinical triage team. Clinician recommendations and next steps will appear here once evaluation is complete.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: REPORTED SYMPTOMS */}
          {activeTab === "intake" && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
              <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
                Your Intake Summary
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="font-semibold text-slate-500 block mb-1">Reported Symptoms</span>
                  <p className="p-2.5 bg-slate-50 rounded-lg text-slate-800 border border-slate-100">
                    {intake?.symptoms?.length ? intake.symptoms.join(", ") : selectedCase.description}
                  </p>
                </div>
                <div>
                  <span className="font-semibold text-slate-500 block mb-1">Onset & Duration</span>
                  <p className="p-2.5 bg-slate-50 rounded-lg text-slate-800 border border-slate-100">
                    {intake?.symptom_onset || "Not specified"} · {intake?.duration || "Not specified"}
                  </p>
                </div>
                <div>
                  <span className="font-semibold text-slate-500 block mb-1">Severity & Progression</span>
                  <p className="p-2.5 bg-slate-50 rounded-lg text-slate-800 border border-slate-100">
                    {intake?.severity_description || "Not specified"} · {intake?.progression || "Not specified"}
                  </p>
                </div>
                <div>
                  <span className="font-semibold text-slate-500 block mb-1">Medical History</span>
                  <p className="p-2.5 bg-slate-50 rounded-lg text-slate-800 border border-slate-100">
                    {intake?.medical_history || "None reported"}
                  </p>
                </div>
                <div>
                  <span className="font-semibold text-slate-500 block mb-1">Current Medications</span>
                  <p className="p-2.5 bg-slate-50 rounded-lg text-slate-800 border border-slate-100">
                    {intake?.current_medications || "None"}
                  </p>
                </div>
                <div>
                  <span className="font-semibold text-slate-500 block mb-1">Allergies</span>
                  <p className="p-2.5 bg-slate-50 rounded-lg text-slate-800 border border-slate-100">
                    {intake?.allergies || "None reported"}
                  </p>
                </div>
              </div>

              {/* Uploaded attachments */}
              {attachments.length > 0 && (
                <div className="pt-2">
                  <span className="font-semibold text-slate-700 text-xs block mb-2">Attached Reports:</span>
                  <div className="space-y-1.5">
                    {attachments.map((att) => (
                      <div
                        key={att.id}
                        className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-xs"
                      >
                        <span className="font-medium text-slate-800">{att.original_filename}</span>
                        <button
                          type="button"
                          onClick={() => downloadAttachment(att.id, att.original_filename)}
                          className="text-teal-700 hover:text-teal-900 font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: INTAKE CHAT HISTORY */}
          {activeTab === "chat" && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
                <h3 className="text-sm font-bold text-slate-900 mb-1">Intake Conversation History</h3>
                <p className="text-xs text-slate-500">
                  Review the conversation between you and CareFlow AI recorded for this intake.
                </p>
              </div>

              {loadingChat ? (
                <div className="py-12 text-center text-xs text-slate-500 bg-white rounded-xl border border-slate-200">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-teal-600" />
                  <span>Loading chat history…</span>
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
                    Retry Loading Conversation
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
                          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                            isAssistant
                              ? "bg-teal-100 text-teal-800"
                              : "bg-slate-200 text-slate-700"
                          }`}
                        >
                          {isAssistant ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
                        </div>
                        <div
                          className={`p-3.5 rounded-2xl text-xs space-y-1 shadow-2xs ${
                            isAssistant
                              ? "bg-white text-slate-800 border border-slate-200 rounded-tl-xs"
                              : "bg-teal-700 text-white rounded-tr-xs"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-4 text-[10px] opacity-75 pb-1 border-b border-current/10">
                            <span className="font-semibold">
                              {isAssistant ? "CareFlow AI Intake" : "You (Patient)"}
                            </span>
                            {m.created_at && (
                              <span>{new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                            )}
                          </div>
                          <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-12 text-center text-xs text-slate-400 bg-white rounded-xl border border-slate-200">
                  <MessageSquare className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="font-semibold text-slate-700">No chat history recorded for this case</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    This intake may have been submitted directly or through a quick form.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: ADVISORY AI SUMMARY */}
          {activeTab === "ai" && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-teal-600" />
                  <span>Advisory AI Summary</span>
                </h3>
                <span className="text-[11px] text-slate-400">Non-Diagnostic Support</span>
              </div>

              {aiSuggestions ? (
                <div className="space-y-4 text-xs">
                  {/* AI Triage Priority Assessment */}
                  {aiSuggestions.suggested_priority && (
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-700">Triage Priority Assessment:</span>
                        <PriorityBadge value={aiSuggestions.suggested_priority} size="sm" />
                      </div>
                      {aiSuggestions.priority_explanation && (
                        <p className="text-slate-600 leading-relaxed italic">
                          {aiSuggestions.priority_explanation}
                        </p>
                      )}
                    </div>
                  )}

                  {aiSuggestions.patient_summary && (
                    <div>
                      <span className="font-semibold text-slate-700 block mb-1">Summary of Concerns:</span>
                      <p className="p-3 bg-slate-50 rounded-lg text-slate-800 border border-slate-200/80 leading-relaxed">
                        {aiSuggestions.patient_summary}
                      </p>
                    </div>
                  )}

                  {aiSuggestions.suggested_follow_up_questions?.length > 0 && (
                    <div>
                      <span className="font-semibold text-slate-700 block mb-1">
                        Helpful Questions to Discuss With Your Doctor:
                      </span>
                      <ul className="list-disc list-inside space-y-1 text-slate-700 p-3 bg-slate-50 rounded-lg border border-slate-200/80">
                        {aiSuggestions.suggested_follow_up_questions.map((q, i) => (
                          <li key={i}>{q}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-500 py-6 text-center italic">
                  AI summary is being generated or awaiting review.
                </p>
              )}

              <div className="p-3 bg-teal-50/50 rounded-lg border border-teal-200/80 text-[11px] text-teal-950 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
                <span>
                  This automated summary is advisory only and does not formulate a medical diagnosis or prescribe treatment. Your clinician evaluates all submitted details directly.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Archive Confirmation Dialog */}
      {showArchiveConfirm && (
        <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-rose-50 text-rose-700 shrink-0">
                <Archive className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900">Archive Patient Case?</h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Are you sure you want to archive <strong>CF-{selectedCase.id} ({selectedCase.patient_name})</strong>?
                </p>
              </div>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 leading-relaxed space-y-1">
              <p className="font-semibold">Safe Archival Notice:</p>
              <p className="text-[11px]">
                Your clinical records, reported symptoms, attached documents, and audit history will remain securely preserved in compliance with medical data safety regulations. The case will be removed from your active view.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowArchiveConfirm(false)}
                disabled={archiving}
                className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleArchiveCase}
                disabled={archiving}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-xl shadow-xs cursor-pointer flex items-center gap-2"
              >
                {archiving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{archiving ? "Archiving…" : "Confirm Archive"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
