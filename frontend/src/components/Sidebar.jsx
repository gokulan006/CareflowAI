import { useState } from "react";
import {
  LayoutDashboard,
  MessageSquareHeart,
  ClipboardList,
  CalendarClock,
  Activity,
  ListOrdered,
  CalendarCheck2,
  LogOut,
  Menu,
  X,
  HeartPulse,
} from "lucide-react";

export default function Sidebar({
  user,
  currentTab,
  onTabChange,
  onSignOut,
  queueCount = 0,
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const isClinician = user?.role === "clinician";

  const patientTabs = [
    { id: "Overview", label: "Health Overview", icon: LayoutDashboard },
    { id: "Intake chat", label: "AI Intake Chat", icon: MessageSquareHeart },
    { id: "Cases", label: "My Cases & Intakes", icon: ClipboardList },
    { id: "Appointments", label: "Appointments", icon: CalendarClock },
  ];

  const clinicianTabs = [
    { id: "Overview", label: "Clinical Overview", icon: Activity },
    {
      id: "Case queue",
      label: "Prioritized Queue",
      icon: ListOrdered,
      badge: queueCount > 0 ? queueCount : null,
    },
    { id: "Appointments", label: "Appointments", icon: CalendarCheck2 },
  ];

  const tabs = isClinician ? clinicianTabs : patientTabs;

  const initials = (user?.full_name || user?.username || "U")
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const handleNavClick = (tabId) => {
    onTabChange(tabId);
    setMobileOpen(false);
  };

  return (
    <>
      {/* Mobile Topbar */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-teal-600 text-white flex items-center justify-center font-bold text-base shadow-xs">
            ✚
          </div>
          <div>
            <span className="font-bold text-slate-900 tracking-tight">careflow</span>
            <span className="font-bold text-teal-600"> AI</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer"
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 z-40 lg:hidden backdrop-blur-xs"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand Area */}
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-600 text-white flex items-center justify-center font-bold text-xl shadow-md shadow-teal-600/20">
              ✚
            </div>
            <div>
              <div className="flex items-center">
                <span className="font-bold text-lg text-slate-900 tracking-tight">careflow</span>
                <span className="font-bold text-lg text-teal-600"> AI</span>
              </div>
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                {isClinician ? "Clinician Workspace" : "Patient Portal"}
              </p>
            </div>
          </div>
        </div>

        {/* Navigation Menu */}
        <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto">
          <div className="px-3 pb-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            {isClinician ? "Clinical Operations" : "Patient Care"}
          </div>

          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleNavClick(tab.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
                  isActive
                    ? "bg-teal-50 text-teal-900 border border-teal-200/80 shadow-2xs font-semibold"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-transparent"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={`w-4 h-4 ${
                      isActive ? "text-teal-600" : "text-slate-400 group-hover:text-slate-600"
                    }`}
                  />
                  <span>{tab.label}</span>
                </div>
                {tab.badge && (
                  <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-rose-100 text-rose-800 border border-rose-200">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Human-in-the-Loop Clinical Assurance Box */}
        <div className="p-3 mx-3 mb-3 bg-slate-50 border border-slate-200/80 rounded-xl">
          <div className="flex items-start gap-2.5">
            <HeartPulse className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
            <div className="text-[11px] leading-relaxed text-slate-600">
              <strong className="font-semibold text-slate-800 block mb-0.5">Human-in-the-Loop</strong>
              AI analysis provides advisory triage insights only. Clinicians make all final decisions.
            </div>
          </div>
        </div>

        {/* User Profile & Sign Out Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-teal-100 text-teal-800 flex items-center justify-center font-bold text-xs shrink-0 border border-teal-200">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 truncate">
                  {user?.full_name || user?.username}
                </p>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  <p className="text-[10px] text-slate-500 capitalize">
                    {user?.role === "clinician" ? "Verified Clinician" : "Patient"}
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onSignOut}
              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
              title="Sign Out"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
