import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "./api";
import {
  createCaseRequestGate,
  getCaseDetailsForSelection,
} from "./caseRequestGate";
import Sidebar from "./components/Sidebar";
import AuthView, { PendingClinicianView } from "./components/AuthView";
import ClinicianDashboard from "./components/ClinicianDashboard";
import CaseDetailModal from "./components/CaseDetailModal";
import PatientDashboard from "./components/PatientDashboard";
import PatientIntakeChat from "./components/PatientIntakeChat";
import PatientCaseDetailModal from "./components/PatientCaseDetailModal";
import AppointmentsView from "./components/AppointmentsView";
import "./App.css";

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // App Data
  const [cases, setCases] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [currentTab, setCurrentTab] = useState("Overview");

  // Active Intake Case State (specifically for PatientIntakeChat)
  const [activeIntakeCaseId, setActiveIntakeCaseId] = useState(() => {
    try {
      return sessionStorage.getItem("careflow_active_case_id") || null;
    } catch {
      return null;
    }
  });

  // Selected Case Detail View State
  const [selectedCase, setSelectedCase] = useState(null);
  const [detail, setDetail] = useState(null);
  const caseRequestGate = useRef(createCaseRequestGate());

  // Determine active case for Patient Intake Chat
  const activeCase =
    cases.find((c) => String(c.id) === String(activeIntakeCaseId)) ||
    cases[0] ||
    null;

  const handleSelectIntakeCase = useCallback((c) => {
    if (!c?.id) return;
    setActiveIntakeCaseId(c.id);
    try {
      sessionStorage.setItem("careflow_active_case_id", String(c.id));
    } catch {
      // ignore
    }
  }, []);

  // Refresh cases and appointments
  const refresh = useCallback(
    async (role = user?.role) => {
      if (!role) return [];
      try {
        const [caseData, appointmentData] = await Promise.all([
          apiRequest("/cases/"),
          apiRequest("/appointments/"),
        ]);
        const caseItems = Array.isArray(caseData) ? caseData : caseData.results || [];
        setCases(caseItems);
        setSelectedCase((prev) => {
          if (!prev?.id) return prev;
          const fresh = caseItems.find((c) => c.id === prev.id);
          return fresh || prev;
        });
        setAppointments(
          Array.isArray(appointmentData) ? appointmentData : appointmentData.results || []
        );
        return caseItems;
      } catch (err) {
        console.warn("Refresh error:", err);
        return [];
      }
    },
    [user?.role]
  );

  // Initial Auth Check
  useEffect(() => {
    apiRequest("/auth/me/")
      .then(async (data) => {
        if (data.authenticated) {
          setUser(data);
          if (data.role === "patient" || data.role === "clinician") {
            await refresh(data.role);
          }
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [refresh]);

  async function handleSignOut() {
    try {
      await apiRequest("/auth/logout/", { method: "POST", body: "{}" });
    } finally {
      setUser(null);
      setCases([]);
      setAppointments([]);
      setSelectedCase(null);
      setDetail(null);
      setActiveIntakeCaseId(null);
      try {
        sessionStorage.removeItem("careflow_active_case_id");
      } catch {
        // ignore
      }
      setCurrentTab("Overview");
    }
  }

  // Open a case for detail view (clinician or patient)
  async function openCase(item) {
    const requestId = caseRequestGate.current.begin();
    setSelectedCase(item);
    setDetail(null);
    setNotice("");

    try {
      const isClinician = user?.role === "clinician";
      const [intake, attachments, consent, activities, aiResults, clinicianReviews, patientAI] =
        await Promise.all([
          apiRequest(`/cases/${item.id}/intake/`).catch((err) =>
            err.message === "No intake submitted yet."
              ? null
              : { unavailable: true, unavailableReason: err.message }
          ),
          apiRequest("/attachments/").then((data) =>
            (Array.isArray(data) ? data : data.results || []).filter((a) => a.case === item.id)
          ),
          apiRequest(`/cases/${item.id}/consent/`).catch(() => []),
          isClinician
            ? apiRequest(`/cases/${item.id}/activities/`).catch(() => [])
            : Promise.resolve([]),
          isClinician
            ? apiRequest(`/cases/${item.id}/ai_results/`).catch(() => [])
            : Promise.resolve([]),
          isClinician
            ? apiRequest(`/cases/${item.id}/reviews/`).catch(() => [])
            : Promise.resolve([]),
          !isClinician
            ? apiRequest(`/cases/${item.id}/patient-ai-suggestions/`).catch((e) => ({
                status: "error",
                detail: e.message,
              }))
            : Promise.resolve(null),
        ]);

      const patientReview = !isClinician
        ? await apiRequest(`/cases/${item.id}/patient-review/`).catch(() => ({ status: "error" }))
        : null;

      if (!caseRequestGate.current.isCurrent(requestId)) return;

      setDetail({
        caseId: item.id,
        intake,
        attachments,
        consent,
        activities,
        aiResults,
        clinicianReviews,
        patientReview,
        patientAI,
      });
    } catch (e) {
      if (caseRequestGate.current.isCurrent(requestId)) {
        setNotice(e.message);
      }
    }
  }

  // Handle case update callback
  function handleCaseUpdated(updatedCase) {
    if (!updatedCase) return;
    setSelectedCase(updatedCase);
    setCases((prev) => prev.map((c) => (c.id === updatedCase.id ? { ...c, ...updatedCase } : c)));
    refresh();
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-teal-600 text-white flex items-center justify-center mx-auto text-xl font-bold shadow-lg shadow-teal-600/20 animate-pulse">
            ✚
          </div>
          <h2 className="text-base font-bold text-slate-800">Loading CareFlow AI…</h2>
          <p className="text-xs text-slate-400">Verifying secure clinical credentials</p>
        </div>
      </div>
    );
  }

  // Not authenticated: Show Login / Registration View
  if (!user) {
    return (
      <AuthView
        onAuthSuccess={async (account) => {
          setUser(account);
          if (account.role === "patient" || account.role === "clinician") {
            await refresh(account.role);
          }
        }}
      />
    );
  }

  // Clinician registered and awaiting approval
  if (user.role === "pending_clinician") {
    return <PendingClinicianView user={user} onSignOut={handleSignOut} />;
  }

  const isClinician = user.role === "clinician";
  const selectedDetail = getCaseDetailsForSelection(detail, selectedCase?.id);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row text-slate-900 antialiased">
      {/* Sidebar Navigation */}
      <Sidebar
        user={user}
        currentTab={currentTab}
        onTabChange={(tabName) => {
          setCurrentTab(tabName);
          setSelectedCase(null);
          setDetail(null);
        }}
        onSignOut={handleSignOut}
        queueCount={cases.filter((c) => c.status === "NEEDS_REVIEW").length}
      />

      {/* Main Workspace Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0 min-h-screen">
        {/* Top Header Breadcrumb */}
        <header className="h-14 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 sticky top-0 z-30 shadow-2xs">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-teal-700">CareFlow AI</span>
            <span className="text-slate-300">/</span>
            <span className="text-slate-600 font-medium">{currentTab}</span>
          </div>

          <div className="flex items-center gap-2.5 text-xs text-slate-500">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            <span>
              Signed in as <strong className="text-slate-800">{user.full_name || user.username}</strong>
            </span>
          </div>
        </header>

        {/* Global Banner Messages */}
        <div className="p-4 sm:p-6 lg:p-8 flex-1 max-w-7xl w-full mx-auto space-y-6">
          {error && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-medium flex items-center justify-between shadow-2xs">
              <span>{error}</span>
              <button onClick={() => setError("")} className="text-rose-700 font-bold">✕</button>
            </div>
          )}
          {notice && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-medium flex items-center justify-between shadow-2xs">
              <span>{notice}</span>
              <button onClick={() => setNotice("")} className="text-emerald-700 font-bold">✕</button>
            </div>
          )}

          {/* CLINICIAN WORKSPACE VIEWS */}
          {isClinician && (
            <>
              {(currentTab === "Overview" || currentTab === "Case queue") && (
                <ClinicianDashboard
                  cases={cases}
                  appointments={appointments}
                  currentUser={user}
                  onOpenCase={openCase}
                  onRefresh={refresh}
                />
              )}

              {currentTab === "Appointments" && (
                <AppointmentsView
                  appointments={appointments}
                  currentUser={user}
                  onRefresh={refresh}
                />
              )}
            </>
          )}

          {/* PATIENT PORTAL VIEWS */}
          {!isClinician && (
            <>
              {currentTab === "Overview" && (
                <PatientDashboard
                  user={user}
                  cases={cases}
                  appointments={appointments}
                  onStartIntake={() => setCurrentTab("Intake chat")}
                  onOpenIntakeChat={(item) => {
                    handleSelectIntakeCase(item);
                    setSelectedCase(null);
                    setDetail(null);
                    setCurrentTab("Intake chat");
                  }}
                  onOpenCase={openCase}
                  onOpenAppointments={() => setCurrentTab("Appointments")}
                  onRefresh={refresh}
                />
              )}

              {currentTab === "Intake chat" && (
                <PatientIntakeChat
                  user={user}
                  activeCase={activeCase}
                  allCases={cases}
                  onSelectCase={handleSelectIntakeCase}
                  onCaseCreated={async (newCase) => {
                    handleSelectIntakeCase(newCase);
                    await refresh();
                  }}
                  onComplete={async (msg) => {
                    await refresh();
                    setNotice(msg);
                    setCurrentTab("Cases");
                  }}
                />
              )}

              {currentTab === "Cases" && (
                <div className="space-y-4">
                  <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
                    <div>
                      <h1 className="text-lg font-bold text-slate-900">Your Submitted Intakes</h1>
                      <p className="text-xs text-slate-500">Track and review all medical requests submitted to your care team</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCurrentTab("Intake chat")}
                      className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs rounded-xl shadow-xs cursor-pointer"
                    >
                      Start New Intake
                    </button>
                  </div>

                  <PatientDashboard
                    user={user}
                    cases={cases}
                    appointments={appointments}
                    onStartIntake={() => setCurrentTab("Intake chat")}
                    onOpenIntakeChat={(item) => {
                      handleSelectIntakeCase(item);
                      setSelectedCase(null);
                      setDetail(null);
                      setCurrentTab("Intake chat");
                    }}
                    onOpenCase={openCase}
                    onOpenAppointments={() => setCurrentTab("Appointments")}
                    onRefresh={refresh}
                  />
                </div>
              )}

              {currentTab === "Appointments" && (
                <AppointmentsView
                  appointments={appointments}
                  currentUser={user}
                  onRefresh={refresh}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Clinician Case Detail Modal Workspace */}
      {selectedCase && isClinician && (
        <CaseDetailModal
          selectedCase={selectedCase}
          detail={selectedDetail}
          currentUser={user}
          onClose={() => {
            setSelectedCase(null);
            setDetail(null);
          }}
          onUpdateCase={handleCaseUpdated}
          onRefresh={refresh}
        />
      )}

      {/* Patient Case Detail Modal */}
      {selectedCase && !isClinician && currentTab !== "Intake chat" && (
        <PatientCaseDetailModal
          selectedCase={selectedCase}
          detail={selectedDetail}
          onClose={() => {
            setSelectedCase(null);
            setDetail(null);
          }}
          onOpenChat={() => {
            handleSelectIntakeCase(selectedCase);
            setSelectedCase(null);
            setDetail(null);
            setCurrentTab("Intake chat");
          }}
          onUpdateCase={handleCaseUpdated}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}
