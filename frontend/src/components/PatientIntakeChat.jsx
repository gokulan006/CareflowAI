import { useState, useRef, useEffect } from "react";
import {
  Send,
  Bot,
  User,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  PlusCircle,
  Loader2,
  ClipboardList,
  Search,
  ListFilter,
  X,
  RefreshCw,
} from "lucide-react";
import VoiceInputButton from "./VoiceInputButton";
import { StatusBadge, PriorityBadge } from "./Badges";
import { apiRequest } from "../api";

function parseCleanIntake(data) {
  if (!data) return null;
  return {
    symptoms: Array.isArray(data.symptoms) ? data.symptoms : [],
    symptom_onset: data.symptom_onset || "",
    duration: data.duration || "",
    severity_description: data.severity_description || "",
    progression: data.progression || "",
    medical_history: data.medical_history || "",
    current_medications: data.current_medications || "",
    allergies: data.allergies || "",
    additional_information: data.additional_information || "",
  };
}

export default function PatientIntakeChat({
  user,
  activeCase,
  allCases = [],
  onSelectCase,
  onCaseCreated,
  onComplete,
}) {
  const [messages, setMessages] = useState([]);
  const [inputDraft, setInputDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState("");
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);

  // Mobile drawer and filter state for cases list
  const [showMobileList, setShowMobileList] = useState(false);
  const [caseFilter, setCaseFilter] = useState("");

  // Review & Confirmation state
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [structuredIntake, setStructuredIntake] = useState({
    symptoms: [],
    symptom_onset: "",
    duration: "",
    severity_description: "",
    progression: "",
    medical_history: "",
    current_medications: "",
    allergies: "",
    additional_information: "",
  });
  const [reportFile, setReportFile] = useState(null);
  const [consentGranted, setConsentGranted] = useState(true);

  // New Case Creation state
  const [showNewCaseModal, setShowNewCaseModal] = useState(!activeCase && allCases.length === 0);
  const [newCaseData, setNewCaseData] = useState({
    patient_name: user?.full_name || user?.username || "",
    description: "",
  });

  const chatEndRef = useRef(null);
  const inputRef = useRef(null);
  const activeCaseIdRef = useRef(activeCase?.id);
  const loadRequestIdRef = useRef(0);
  const sendRequestIdRef = useRef(0);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  // Unified selection handler for both case list and dropdown
  function handleSelectCase(caseOrId) {
    const target =
      typeof caseOrId === "object" && caseOrId !== null
        ? caseOrId
        : allCases.find((c) => String(c.id) === String(caseOrId));

    if (!target) return;
    setShowMobileList(false);
    if (activeCase?.id === target.id) return;

    onSelectCase?.(target);
  }

  // Load chat history and intake when active case changes
  useEffect(() => {
    let ignore = false;
    activeCaseIdRef.current = activeCase?.id;
    const caseId = activeCase?.id;
    const requestId = ++loadRequestIdRef.current;

    queueMicrotask(() => {
      if (ignore) return;
      // Immediately clear state for clean case transition without message bleed
      setMessages([]);
      setInputDraft("");
      setError("");
      setBusy(false);
      setShowReviewModal(false);
      setStructuredIntake({
        symptoms: [],
        symptom_onset: "",
        duration: "",
        severity_description: "",
        progression: "",
        medical_history: "",
        current_medications: "",
        allergies: "",
        additional_information: "",
      });
      setLoadingHistory(Boolean(caseId));
    });

    if (!caseId) {
      return;
    }

    apiRequest(`/cases/${caseId}/chat/`)
      .then((history) => {
        if (ignore || loadRequestIdRef.current !== requestId || activeCaseIdRef.current !== caseId) return;
        if (Array.isArray(history) && history.length > 0) {
          setMessages(history);
        } else {
          return apiRequest(`/cases/${caseId}/chat/`, {
            method: "POST",
            body: JSON.stringify({ start: true }),
          })
            .then((res) => {
              if (ignore || loadRequestIdRef.current !== requestId || activeCaseIdRef.current !== caseId) return;
              if (res) {
                setMessages([
                  {
                    role: "assistant",
                    content: res.message,
                    created_at: new Date().toISOString(),
                  },
                ]);
              }
            })
            .catch(() => {
              if (ignore || loadRequestIdRef.current !== requestId || activeCaseIdRef.current !== caseId) return;
              setMessages([
                {
                  role: "assistant",
                  content:
                    "Hello, I am CareFlow AI's clinical intake assistant. Please describe the symptoms you are experiencing today, when they began, and how severe they feel.",
                  created_at: new Date().toISOString(),
                },
              ]);
            });
        }
      })
      .catch((err) => {
        if (ignore || loadRequestIdRef.current !== requestId || activeCaseIdRef.current !== caseId) return;
        console.warn("Could not load chat history:", err);
        setError(err.message || "Failed to load chat history for this case.");
      })
      .finally(() => {
        if (!ignore && loadRequestIdRef.current === requestId && activeCaseIdRef.current === caseId) {
          setLoadingHistory(false);
        }
      });

    apiRequest(`/cases/${caseId}/intake/`)
      .then((data) => {
        if (ignore || loadRequestIdRef.current !== requestId || activeCaseIdRef.current !== caseId) return;
        const clean = parseCleanIntake(data);
        if (clean) {
          setStructuredIntake(clean);
        }
      })
      .catch(() => {});

    return () => {
      ignore = true;
    };
  }, [activeCase?.id]);

  // Retry loading case data helper
  function handleRetryLoad() {
    if (!activeCase?.id) return;
    const caseId = activeCase.id;
    const requestId = ++loadRequestIdRef.current;
    setLoadingHistory(true);
    setError("");

    apiRequest(`/cases/${caseId}/chat/`)
      .then((history) => {
        if (loadRequestIdRef.current !== requestId || activeCaseIdRef.current !== caseId) return;
        if (Array.isArray(history) && history.length > 0) {
          setMessages(history);
        } else {
          return apiRequest(`/cases/${caseId}/chat/`, {
            method: "POST",
            body: JSON.stringify({ start: true }),
          }).then((res) => {
            if (loadRequestIdRef.current !== requestId || activeCaseIdRef.current !== caseId) return;
            if (res) {
              setMessages([
                {
                  role: "assistant",
                  content: res.message,
                  created_at: new Date().toISOString(),
                },
              ]);
            }
          });
        }
      })
      .catch((err) => {
        if (loadRequestIdRef.current !== requestId || activeCaseIdRef.current !== caseId) return;
        setError(err.message || "Failed to load chat history for this case.");
      })
      .finally(() => {
        if (loadRequestIdRef.current === requestId && activeCaseIdRef.current === caseId) {
          setLoadingHistory(false);
        }
      });

    apiRequest(`/cases/${caseId}/intake/`)
      .then((data) => {
        if (loadRequestIdRef.current !== requestId || activeCaseIdRef.current !== caseId) return;
        const clean = parseCleanIntake(data);
        if (clean) setStructuredIntake(clean);
      })
      .catch(() => {});
  }

  async function handleSendMessage(e, textOverride = null) {
    e?.preventDefault();
    const text = (typeof textOverride === "string" ? textOverride : inputDraft).trim();
    if (!text || busy || !activeCase?.id) return;

    const targetCaseId = activeCase.id;
    const sendId = ++sendRequestIdRef.current;

    setInputDraft("");
    const userMsg = {
      role: "patient",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setBusy(true);
    setError("");

    try {
      const res = await apiRequest(`/cases/${targetCaseId}/chat/`, {
        method: "POST",
        body: JSON.stringify({ message: text }),
      });

      // Guard: if patient switched cases while waiting for reply, do not mix into current case!
      if (activeCaseIdRef.current !== targetCaseId || sendRequestIdRef.current !== sendId) {
        return;
      }

      const assistantMsg = {
        role: "assistant",
        content: res.message,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Refresh current intake data in background
      apiRequest(`/cases/${targetCaseId}/intake/`)
        .then((data) => {
          if (activeCaseIdRef.current !== targetCaseId) return;
          const clean = parseCleanIntake(data);
          if (clean) setStructuredIntake(clean);
        })
        .catch(() => {});
    } catch (err) {
      if (activeCaseIdRef.current === targetCaseId) {
        setError(err.message || "Message delivery failed. Please retry.");
      }
    } finally {
      if (activeCaseIdRef.current === targetCaseId) {
        setBusy(false);
      }
    }
  }

  function handleVoiceTranscript(transcriptText) {
    if (!transcriptText || !transcriptText.trim()) return;
    const cleanText = transcriptText.trim();
    setInputDraft((prev) => {
      const trimmed = prev.trim();
      return trimmed ? `${trimmed} ${cleanText}` : cleanText;
    });
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  }

  function handleVoiceDirectSend(transcriptText) {
    if (!transcriptText || !transcriptText.trim()) return;
    handleSendMessage(null, transcriptText.trim());
  }

  async function handleCreateNewCase(e) {
    e.preventDefault();
    if (!newCaseData.description.trim()) {
      setError("Please briefly describe your main health concern.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const created = await apiRequest("/cases/", {
        method: "POST",
        body: JSON.stringify({
          patient_name: newCaseData.patient_name || user?.username,
          description: newCaseData.description.trim(),
          preferred_language: "en",
        }),
      });

      // Automatically grant patient consent for processing
      await apiRequest(`/cases/${created.id}/consent/`, {
        method: "POST",
        body: JSON.stringify({
          granted: true,
          purpose: "CareFlow AI case processing and clinician review",
          notice_version: "1.0",
        }),
      });

      setShowNewCaseModal(false);
      setNewCaseData({ patient_name: user?.full_name || user?.username, description: "" });
      onCaseCreated?.(created);
    } catch (err) {
      setError(err.message || "Failed to create new intake case.");
    } finally {
      setBusy(false);
    }
  }

  async function handleFinalSubmitIntake() {
    if (!activeCase) return;
    if (!consentGranted) {
      setError("Active patient consent is required to submit your intake for clinical review.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      // 0. Ensure patient consent is active before AI submission
      await apiRequest(`/cases/${activeCase.id}/consent/`, {
        method: "POST",
        body: JSON.stringify({
          granted: true,
          purpose: "CareFlow AI clinical triage and OpenAI priority assessment",
          notice_version: "1.0",
        }),
      }).catch(() => {});

      // 1. Submit structured intake updates
      await apiRequest(`/cases/${activeCase.id}/intake/`, {
        method: "PUT",
        body: JSON.stringify(structuredIntake),
      });

      // 2. Upload medical report if provided
      if (reportFile) {
        const formData = new FormData();
        formData.append("file", reportFile);
        await apiRequest(`/cases/${activeCase.id}/attachments/`, {
          method: "POST",
          body: formData,
        });
      }

      // 3. Confirm intake chat
      await apiRequest(`/cases/${activeCase.id}/chat/`, {
        method: "POST",
        body: JSON.stringify({
          confirm: true,
          intake: structuredIntake,
        }),
      });

      // 4. Trigger AI Triage pipeline for priority evaluation
      await apiRequest(`/cases/${activeCase.id}/submit-ai/`, {
        method: "POST",
        body: "{}",
      }).catch((err) => {
        console.warn("AI triage submission notice:", err);
      });

      setShowReviewModal(false);
      onComplete?.(
        `Case CF-${activeCase.id} submitted successfully! Your intake details have been securely prioritized and sent to your clinical care team.`
      );
    } catch (err) {
      setError(err.message || "Intake submission failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // Filter cases in list
  const filteredCases = allCases.filter((c) => {
    if (!caseFilter.trim()) return true;
    const term = caseFilter.toLowerCase();
    return (
      String(c.id).includes(term) ||
      (c.patient_name && c.patient_name.toLowerCase().includes(term)) ||
      (c.description && c.description.toLowerCase().includes(term)) ||
      (c.status && c.status.toLowerCase().includes(term))
    );
  });

  // Calculate conversational progress milestone
  const hasHistory = messages.length > 2;
  const hasSymptoms = structuredIntake.symptoms.length > 0 || messages.length > 3;
  const hasSeverityOrDuration = Boolean(
    structuredIntake.duration || structuredIntake.severity_description || messages.length > 5
  );

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] max-w-6xl mx-auto bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
      {/* Top Header Bar */}
      <div className="px-5 py-3.5 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowMobileList(!showMobileList)}
            className="lg:hidden p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 cursor-pointer flex items-center gap-1.5 text-xs font-semibold"
            aria-label="Toggle case list"
          >
            <ListFilter className="w-4 h-4 text-teal-600" />
            <span>Cases ({allCases.length})</span>
          </button>

          <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-slate-900 text-base">AI Clinical Intake Assistant</h2>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Assistant
              </span>
            </div>
            <p className="text-xs text-slate-500">
              {activeCase
                ? `Active Case CF-${activeCase.id}: ${activeCase.patient_name || user?.full_name}`
                : "Select an intake case or start a new concern below"}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Case Selector Dropdown (uses the exact same handleSelectCase handler) */}
          {allCases.length > 0 && (
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
              <span className="text-[11px] font-semibold text-slate-500 hidden sm:inline">Switch:</span>
              <select
                value={activeCase?.id || ""}
                onChange={(e) => handleSelectCase(e.target.value)}
                className="bg-transparent text-xs font-semibold text-slate-800 focus:outline-none cursor-pointer max-w-[170px] sm:max-w-[220px] truncate"
                aria-label="Switch active intake case"
              >
                {allCases.map((c) => (
                  <option key={c.id} value={c.id}>
                    CF-{c.id}: {c.description ? (c.description.length > 22 ? `${c.description.slice(0, 22)}…` : c.description) : c.patient_name} ({c.status})
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowNewCaseModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors cursor-pointer"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New Case</span>
          </button>

          {activeCase && (
            <button
              type="button"
              onClick={() => setShowReviewModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Review & Submit</span>
            </button>
          )}
        </div>
      </div>

      {/* Emergency guidance banner */}
      <div className="bg-amber-50/80 px-4 py-2 border-b border-amber-200/80 text-amber-900 text-xs flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            <strong>Emergency Notice:</strong> If you are experiencing acute chest pain, severe shortness of breath, sudden facial droop or numbness, or severe bleeding, please call <strong>911</strong> or seek emergency care immediately.
          </span>
        </div>
      </div>

      {/* Main Workspace: 2-Column Split (Case List Sidebar + Chat Conversation) */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* Mobile Backdrop */}
        {showMobileList && (
          <div
            className="fixed inset-0 bg-slate-900/40 z-30 lg:hidden backdrop-blur-2xs"
            onClick={() => setShowMobileList(false)}
          />
        )}

        {/* LEFT SIDE: Interactive Case List Sidebar */}
        <aside
          className={`w-72 sm:w-80 border-r border-slate-200 bg-slate-50/60 flex flex-col shrink-0 transition-transform duration-200 ease-in-out z-40 lg:static lg:translate-x-0 ${
            showMobileList
              ? "fixed inset-y-0 left-0 bg-white shadow-xl translate-x-0"
              : "hidden lg:flex"
          }`}
        >
          {/* Case list sidebar header */}
          <div className="p-3.5 border-b border-slate-200 bg-white flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-teal-600" />
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Intake Cases ({allCases.length})
              </h3>
            </div>
            {showMobileList && (
              <button
                type="button"
                onClick={() => setShowMobileList(false)}
                className="p-1 text-slate-400 hover:text-slate-700 lg:hidden cursor-pointer"
                aria-label="Close case drawer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Quick case filter input if cases > 2 */}
          {allCases.length > 2 && (
            <div className="p-2.5 border-b border-slate-200 bg-white/80 shrink-0">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={caseFilter}
                  onChange={(e) => setCaseFilter(e.target.value)}
                  placeholder="Filter cases by symptom or ID…"
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs placeholder:text-slate-400 focus:outline-none focus:border-teal-500 focus:bg-white transition-colors"
                />
              </div>
            </div>
          )}

          {/* Scrollable list of case cards */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
            {filteredCases.length > 0 ? (
              filteredCases.map((c) => {
                const isActive = activeCase?.id === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleSelectCase(c)}
                    className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer relative group ${
                      isActive
                        ? "bg-teal-50/90 border-teal-500 shadow-xs ring-1 ring-teal-500/30 text-teal-950 font-semibold"
                        : "bg-white hover:bg-slate-50 border-slate-200/90 text-slate-700 hover:border-slate-300 shadow-2xs"
                    }`}
                    aria-label={`Select case CF-${c.id}`}
                    aria-selected={isActive}
                  >
                    <div className="flex items-center justify-between gap-1.5 mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded-md border ${
                            isActive
                              ? "bg-teal-600 text-white border-teal-600"
                              : "bg-teal-50 text-teal-800 border-teal-200"
                          }`}
                        >
                          CF-{c.id}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {c.created_at
                            ? new Date(c.created_at).toLocaleDateString([], {
                                month: "short",
                                day: "numeric",
                              })
                            : ""}
                        </span>
                      </div>
                      <StatusBadge value={c.status} size="sm" />
                    </div>

                    <p className="text-xs line-clamp-2 leading-relaxed text-slate-800">
                      {c.description || "General Intake Session"}
                    </p>

                    <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-100 text-[11px]">
                      <PriorityBadge value={c.priority} size="sm" />
                      {isActive && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-teal-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-teal-600 animate-pulse" />
                          <span>Active Chat</span>
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="py-8 px-4 text-center text-xs text-slate-400 space-y-2">
                <ClipboardList className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="font-semibold text-slate-600">No matching cases</p>
                <p className="text-[11px]">
                  {allCases.length === 0
                    ? "Start a new intake case to begin your symptoms interview."
                    : "No cases match your filter."}
                </p>
                <button
                  type="button"
                  onClick={() => setShowNewCaseModal(true)}
                  className="px-3 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg cursor-pointer mt-2"
                >
                  + New Intake Case
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* RIGHT SIDE: Active Chat Conversation Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-white">
          {/* Milestone Progress Bar */}
          {activeCase && (
            <div className="px-5 py-2 bg-slate-50/70 border-b border-slate-200/80 text-xs text-slate-600 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 sm:gap-6 overflow-x-auto w-full">
                <span
                  className={`inline-flex items-center gap-1 font-semibold whitespace-nowrap ${
                    hasHistory ? "text-teal-700" : "text-slate-400"
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] text-white ${
                      hasHistory ? "bg-teal-600" : "bg-slate-300"
                    }`}
                  >
                    1
                  </span>
                  Chief Complaint
                </span>
                <span className="text-slate-300">→</span>
                <span
                  className={`inline-flex items-center gap-1 font-semibold whitespace-nowrap ${
                    hasSymptoms ? "text-teal-700" : "text-slate-400"
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] text-white ${
                      hasSymptoms ? "bg-teal-600" : "bg-slate-300"
                    }`}
                  >
                    2
                  </span>
                  Symptoms & Duration
                </span>
                <span className="text-slate-300">→</span>
                <span
                  className={`inline-flex items-center gap-1 font-semibold whitespace-nowrap ${
                    hasSeverityOrDuration ? "text-teal-700" : "text-slate-400"
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] text-white ${
                      hasSeverityOrDuration ? "bg-teal-600" : "bg-slate-300"
                    }`}
                  >
                    3
                  </span>
                  History & Medications
                </span>
                <span className="text-slate-300">→</span>
                <span className="inline-flex items-center gap-1 font-semibold text-slate-400 whitespace-nowrap">
                  <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] text-white bg-slate-300">
                    4
                  </span>
                  Review & Submit
                </span>
              </div>
            </div>
          )}

          {/* Error Banner with Retry */}
          {error && (
            <div className="px-5 py-2.5 bg-rose-50 border-b border-rose-200 text-xs text-rose-800 flex items-center justify-between shrink-0 shadow-2xs">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{error}</span>
              </div>
              <div className="flex items-center gap-2">
                {activeCase && (
                  <button
                    type="button"
                    onClick={handleRetryLoad}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-rose-700 bg-white hover:bg-rose-100 border border-rose-200 rounded-md cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Retry</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setError("")}
                  className="text-rose-700 font-bold ml-1 cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Main Chat Conversation Scroll Area */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-slate-50/40">
            {!activeCase ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 max-w-md mx-auto">
                <div className="w-16 h-16 rounded-2xl bg-teal-50 border border-teal-200 text-teal-600 flex items-center justify-center mb-4">
                  <Sparkles className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-1">Select or Start an Intake Case</h3>
                <p className="text-sm text-slate-500 mb-5 leading-relaxed">
                  Choose an intake session from the case list or initialize a new concern to start your clinical symptom interview.
                </p>
                <button
                  type="button"
                  onClick={() => setShowNewCaseModal(true)}
                  className="py-2.5 px-5 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-xl shadow-md shadow-teal-600/20 transition-all cursor-pointer"
                >
                  Start New Intake Case
                </button>
              </div>
            ) : loadingHistory ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-slate-500">
                <Loader2 className="w-8 h-8 animate-spin text-teal-600 mb-2" />
                <p className="text-sm font-semibold text-slate-800">
                  Loading conversation for Case CF-{activeCase.id}…
                </p>
                <p className="text-xs text-slate-400 mt-0.5">Connecting to clinical intake assistant</p>
              </div>
            ) : (
              <>
                {/* Conversation greeting card */}
                <div className="bg-white rounded-xl border border-slate-200/80 p-4 shadow-2xs text-xs text-slate-600 space-y-1.5">
                  <p className="font-semibold text-slate-800 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-teal-600" />
                    <span>CareFlow AI Intake Assistant — CF-{activeCase.id}</span>
                  </p>
                  <p>
                    Please answer the follow-up questions at your own pace. You can type or use the microphone button to speak your responses. You will be able to review and edit all extracted details before final clinical submission.
                  </p>
                </div>

                {/* Chat Transcript Bubbles */}
                {messages.map((msg, idx) => {
                  const isAssistant = msg.role === "assistant";
                  return (
                    <div
                      key={idx}
                      className={`flex gap-3 max-w-2xl ${
                        isAssistant ? "mr-auto" : "ml-auto flex-row-reverse"
                      }`}
                    >
                      <div
                        className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-xs font-bold ${
                          isAssistant
                            ? "bg-teal-600 text-white shadow-xs"
                            : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {isAssistant ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold text-slate-500">
                            {isAssistant ? "CareFlow AI" : "You"}
                          </span>
                          {msg.created_at && (
                            <span className="text-[10px] text-slate-400">
                              {new Date(msg.created_at).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          )}
                        </div>

                        <div
                          className={`p-4 rounded-2xl text-xs sm:text-sm leading-relaxed ${
                            isAssistant
                              ? "bg-white text-slate-800 border border-slate-200 shadow-2xs rounded-tl-xs"
                              : "bg-teal-600 text-white rounded-tr-xs shadow-xs"
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Live Assistant Typing Indicator */}
                {busy && (
                  <div className="flex gap-3 max-w-md mr-auto">
                    <div className="w-8 h-8 rounded-xl bg-teal-600 text-white flex items-center justify-center shrink-0 text-xs shadow-xs">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div className="p-3.5 bg-white border border-slate-200 rounded-2xl rounded-tl-xs shadow-2xs flex items-center gap-2 text-xs text-slate-500">
                      <Loader2 className="w-4 h-4 animate-spin text-teal-600" />
                      <span>CareFlow AI is formulating follow-up guidance…</span>
                    </div>
                  </div>
                )}

                <div ref={chatEndRef} />
              </>
            )}
          </div>

          {/* Chat Input Dock */}
          {activeCase && (
            <div className="p-4 bg-white border-t border-slate-200 shrink-0">
              <form onSubmit={handleSendMessage} className="space-y-2">
                <div className="relative flex items-center rounded-2xl border border-slate-300 focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20 bg-slate-50 transition-all overflow-hidden shadow-2xs">
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputDraft}
                    onChange={(e) => setInputDraft(e.target.value)}
                    placeholder={
                      isVoiceRecording
                        ? "Listening… speak your symptoms clearly into your microphone"
                        : "Type your symptoms, duration, or answer the assistant's questions…"
                    }
                    disabled={busy || loadingHistory}
                    className="flex-1 py-3.5 pl-4 pr-24 bg-transparent text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none disabled:opacity-50"
                  />

                  {/* Input Toolbar with Voice and Send Buttons */}
                  <div className="absolute right-2 flex items-center gap-1.5">
                    <VoiceInputButton
                      onTranscript={handleVoiceTranscript}
                      onDirectSend={handleVoiceDirectSend}
                      disabled={busy || loadingHistory}
                      onRecordingStateChange={setIsVoiceRecording}
                    />

                    <button
                      type="submit"
                      disabled={busy || loadingHistory || !inputDraft.trim()}
                      className="p-2 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:bg-slate-200 text-white disabled:text-slate-400 shadow-xs transition-all cursor-pointer disabled:cursor-not-allowed"
                      aria-label="Send message"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
                  <span>Press <strong>Enter</strong> to send. Click the microphone for speech-to-text.</span>
                  <span>Responses evaluated under qualified clinical supervision.</span>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Start New Case */}
      {showNewCaseModal && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900 mb-1">Start New Health Concern</h3>
            <p className="text-xs text-slate-500 mb-4">
              Provide a brief description of what you are experiencing today to initialize the intake session.
            </p>

            <form onSubmit={handleCreateNewCase} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Patient Name
                </label>
                <input
                  type="text"
                  value={newCaseData.patient_name}
                  onChange={(e) =>
                    setNewCaseData((prev) => ({ ...prev, patient_name: e.target.value }))
                  }
                  required
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Main Concern / Initial Symptoms
                </label>
                <textarea
                  value={newCaseData.description}
                  onChange={(e) =>
                    setNewCaseData((prev) => ({ ...prev, description: e.target.value }))
                  }
                  rows={3}
                  required
                  placeholder="e.g. Mild headache and persistent dry cough for the past 3 days."
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                {allCases.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowNewCaseModal(false)}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-xl shadow-xs cursor-pointer"
                >
                  {busy ? "Starting…" : "Begin AI Intake"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Review & Edit Structured Intake Before Submission */}
      {showReviewModal && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-2xl w-full p-6 shadow-2xl my-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Review & Confirm Intake Information</h3>
                <p className="text-xs text-slate-500">
                  Review the details collected during your AI intake. You can edit any field before submitting to clinicians.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowReviewModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              {/* Symptoms */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Reported Symptoms (comma separated)
                </label>
                <input
                  type="text"
                  value={structuredIntake.symptoms.join(", ")}
                  onChange={(e) =>
                    setStructuredIntake((prev) => ({
                      ...prev,
                      symptoms: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                    }))
                  }
                  placeholder="e.g. headache, fever, sore throat"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                />
              </div>

              {/* Onset and Duration */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Symptom Onset
                  </label>
                  <input
                    type="text"
                    value={structuredIntake.symptom_onset}
                    onChange={(e) =>
                      setStructuredIntake((prev) => ({ ...prev, symptom_onset: e.target.value }))
                    }
                    placeholder="e.g. started yesterday morning"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Duration
                  </label>
                  <input
                    type="text"
                    value={structuredIntake.duration}
                    onChange={(e) =>
                      setStructuredIntake((prev) => ({ ...prev, duration: e.target.value }))
                    }
                    placeholder="e.g. 2 days"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                  />
                </div>
              </div>

              {/* Severity and Progression */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Severity Description
                  </label>
                  <input
                    type="text"
                    value={structuredIntake.severity_description}
                    onChange={(e) =>
                      setStructuredIntake((prev) => ({
                        ...prev,
                        severity_description: e.target.value,
                      }))
                    }
                    placeholder="e.g. Moderate, tolerable with rest"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Progression
                  </label>
                  <input
                    type="text"
                    value={structuredIntake.progression}
                    onChange={(e) =>
                      setStructuredIntake((prev) => ({ ...prev, progression: e.target.value }))
                    }
                    placeholder="e.g. stable, getting worse"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                  />
                </div>
              </div>

              {/* Medical History */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Relevant Medical History
                </label>
                <textarea
                  value={structuredIntake.medical_history}
                  onChange={(e) =>
                    setStructuredIntake((prev) => ({ ...prev, medical_history: e.target.value }))
                  }
                  rows={2}
                  placeholder="e.g. Asthma, hypertension, none"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                />
              </div>

              {/* Current Medications & Allergies */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Current Medications
                  </label>
                  <input
                    type="text"
                    value={structuredIntake.current_medications}
                    onChange={(e) =>
                      setStructuredIntake((prev) => ({
                        ...prev,
                        current_medications: e.target.value,
                      }))
                    }
                    placeholder="e.g. Albuterol inhaler, Ibuprofen"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Known Allergies
                  </label>
                  <input
                    type="text"
                    value={structuredIntake.allergies}
                    onChange={(e) =>
                      setStructuredIntake((prev) => ({ ...prev, allergies: e.target.value }))
                    }
                    placeholder="e.g. Penicillin, pollen, no known allergies"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                  />
                </div>
              </div>

              {/* Medical Report File Upload */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Attach Medical Report (PDF, JPEG, or PNG)
                </label>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  onChange={(e) => setReportFile(e.target.files?.[0] || null)}
                  className="text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100"
                />
                <p className="text-[11px] text-slate-400 mt-1">Files are stored securely and privately for clinician review only.</p>
              </div>

              {/* Consent Checkbox */}
              <label className="flex items-start gap-2.5 p-3 bg-teal-50/50 border border-teal-200/80 rounded-xl text-xs text-teal-950 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentGranted}
                  onChange={(e) => setConsentGranted(e.target.checked)}
                  className="mt-0.5 rounded text-teal-600 focus:ring-teal-500"
                />
                <span>
                  I consent to CareFlow AI processing this information and sharing it securely with authorized clinical staff for human-led review and triage.
                </span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100 mt-4">
              <button
                type="button"
                onClick={() => setShowReviewModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Continue Chat
              </button>
              <button
                type="button"
                onClick={handleFinalSubmitIntake}
                disabled={busy || !consentGranted}
                className="px-5 py-2 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                {busy ? "Submitting…" : "Confirm & Submit for Review"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
