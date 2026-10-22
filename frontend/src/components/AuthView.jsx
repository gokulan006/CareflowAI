import { useState } from "react";
import { Eye, EyeOff, User, Stethoscope, ShieldCheck, AlertCircle, ArrowRight } from "lucide-react";
import { apiRequest, getCsrfToken } from "../api";

export default function AuthView({ onAuthSuccess }) {
  const [isRegister, setIsRegister] = useState(false);
  const [accountType, setAccountType] = useState("patient"); // "patient" | "clinician"
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    password_confirmation: "",
    full_name: "",
    email: "",
  });

  function handleChange(e) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (error) setError("");
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    if (!formData.username.trim() || !formData.password) {
      setError("Please enter both username and password.");
      return;
    }

    setLoading(true);
    try {
      await getCsrfToken();
      const user = await apiRequest("/auth/login/", {
        method: "POST",
        body: JSON.stringify({
          username: formData.username.trim(),
          password: formData.password,
        }),
      });
      onAuthSuccess(user);
    } catch (err) {
      setError(err.message || "Failed to sign in. Please verify your credentials.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setError("");

    if (!formData.full_name.trim()) {
      setError("Please enter your full name.");
      return;
    }
    if (!formData.username.trim()) {
      setError("Please choose a username.");
      return;
    }
    if (accountType === "clinician" && !formData.email.trim()) {
      setError("Clinician registration requires a valid email address.");
      return;
    }
    if (formData.password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    if (formData.password !== formData.password_confirmation) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await getCsrfToken();
      const user = await apiRequest("/auth/register/", {
        method: "POST",
        body: JSON.stringify({
          account_type: accountType,
          full_name: formData.full_name.trim(),
          username: formData.username.trim(),
          email: formData.email.trim(),
          password: formData.password,
          password_confirmation: formData.password_confirmation,
        }),
      });
      onAuthSuccess(user);
    } catch (err) {
      setError(err.message || "Registration could not be completed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-linear-to-b from-slate-50 via-teal-50/20 to-slate-100 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md">
        {/* Healthcare Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-teal-600 text-white shadow-lg shadow-teal-600/20 mb-3">
            <span className="text-2xl font-bold tracking-tight">✚</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">CareFlow AI</h1>
          <p className="text-sm text-slate-600 mt-1">Human-in-the-Loop Healthcare Triage Assistant</p>
        </div>

        {/* Auth Card */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xl shadow-slate-200/50 p-6 sm:p-8">
          <div className="flex border-b border-slate-100 mb-6">
            <button
              type="button"
              onClick={() => {
                setIsRegister(false);
                setError("");
              }}
              className={`flex-1 pb-3 text-sm font-semibold text-center border-b-2 transition-colors cursor-pointer ${
                !isRegister
                  ? "border-teal-600 text-teal-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setIsRegister(true);
                setError("");
              }}
              className={`flex-1 pb-3 text-sm font-semibold text-center border-b-2 transition-colors cursor-pointer ${
                isRegister
                  ? "border-teal-600 text-teal-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              Create Account
            </button>
          </div>

          {error && (
            <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-sm flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {isRegister ? (
            <form onSubmit={handleRegister} className="space-y-4">
              {/* Role Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                  I am a
                </label>
                <div className="grid grid-cols-2 gap-3" role="group" aria-label="Account Role">
                  <button
                    type="button"
                    onClick={() => setAccountType("patient")}
                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-sm font-semibold transition-all cursor-pointer ${
                      accountType === "patient"
                        ? "border-teal-600 bg-teal-50/70 text-teal-900 ring-2 ring-teal-500/20 shadow-xs"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <User className={`w-4 h-4 ${accountType === "patient" ? "text-teal-600" : "text-slate-400"}`} />
                    <span>Patient</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountType("clinician")}
                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-sm font-semibold transition-all cursor-pointer ${
                      accountType === "clinician"
                        ? "border-teal-600 bg-teal-50/70 text-teal-900 ring-2 ring-teal-500/20 shadow-xs"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <Stethoscope className={`w-4 h-4 ${accountType === "clinician" ? "text-teal-600" : "text-slate-400"}`} />
                    <span>Clinician</span>
                  </button>
                </div>
                {accountType === "clinician" && (
                  <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 shrink-0 text-amber-600" />
                    <span>Clinician accounts require administrative credential approval prior to patient data access.</span>
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Full Name
                </label>
                <input
                  type="text"
                  name="full_name"
                  value={formData.full_name}
                  onChange={handleChange}
                  placeholder={accountType === "clinician" ? "Dr. Jane Smith" : "John Doe"}
                  required
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-600 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Username
                </label>
                <input
                  type="text"
                  name="username"
                  value={formData.username}
                  onChange={handleChange}
                  placeholder="e.g. janesmith"
                  required
                  autoComplete="username"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-600 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Email Address {accountType === "patient" && <span className="font-normal text-slate-400">(optional)</span>}
                </label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="name@example.com"
                  required={accountType === "clinician"}
                  autoComplete="email"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-600 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    placeholder="Minimum 8 characters"
                    required
                    autoComplete="new-password"
                    className="w-full px-3.5 py-2.5 pr-10 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-600 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    name="password_confirmation"
                    value={formData.password_confirmation}
                    onChange={handleChange}
                    placeholder="Repeat password"
                    required
                    autoComplete="new-password"
                    className="w-full px-3.5 py-2.5 pr-10 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-600 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-3 px-4 bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white font-semibold rounded-xl shadow-md shadow-teal-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <span>{loading ? "Creating Account…" : `Register as ${accountType === "clinician" ? "Clinician" : "Patient"}`}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Username
                </label>
                <input
                  type="text"
                  name="username"
                  value={formData.username}
                  onChange={handleChange}
                  placeholder="Enter your username"
                  required
                  autoComplete="username"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-600 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    placeholder="Enter your password"
                    required
                    autoComplete="current-password"
                    className="w-full px-3.5 py-2.5 pr-10 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-600 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-3 px-4 bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white font-semibold rounded-xl shadow-md shadow-teal-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <span>{loading ? "Signing in…" : "Sign In to Workspace"}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          )}

          {/* Clinical safety note */}
          <div className="mt-6 pt-5 border-t border-slate-100 flex items-start gap-2.5 text-xs text-slate-500">
            <ShieldCheck className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
            <span>
              CareFlow AI provides advisory triage support for clinical teams. In life-threatening emergencies, dial 911 or visit your nearest emergency department immediately.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PendingClinicianView({ user, onSignOut }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-xl p-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto mb-4">
          <ShieldCheck className="w-8 h-8" />
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 mb-3">
          <span>Registration Status: Pending Approval</span>
        </div>
        <h2 className="text-xl font-bold text-slate-900 mb-2">Clinician Verification in Progress</h2>
        <p className="text-sm text-slate-600 mb-4 leading-relaxed">
          Thank you for registering as a healthcare provider, <strong>{user.full_name || user.username}</strong>. To ensure patient safety and privacy, clinician tools and patient records remain locked until clinical credentials are authenticated by clinic administration.
        </p>
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 mb-6 text-left space-y-1">
          <p><strong>Username:</strong> {user.username}</p>
          <p><strong>Email:</strong> {user.email || "Not specified"}</p>
        </div>
        <button
          onClick={onSignOut}
          className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors cursor-pointer"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
