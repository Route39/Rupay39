import { useState, useEffect } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { Loader2, Lock, Mail, User, Shield, AlertCircle, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMe, useBranding } from "@/context/MeContext";
import { Logo } from "@/components/AppShell";
import { errMsg } from "@/lib/api";

const PRESET_ACCOUNTS = [
  { label: "Super Admin", email: "support@route39.in", role: "Super Admin" },
  { label: "Finance Admin", email: "finance@route39.in", role: "Finance Admin" },
  { label: "Supervisor", email: "supervisor@route39.in", role: "City Supervisor" },
];

export default function AuthPage({ mode = "sign-in" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const brand = useBranding();
  const { me, isStaff, login, register } = useMe();

  const [tab, setTab] = useState(mode === "sign-up" ? "sign-up" : "sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setTab(mode === "sign-up" ? "sign-up" : "sign-in");
  }, [mode]);

  useEffect(() => {
    if (me && isStaff) {
      navigate("/", { replace: true });
    }
  }, [me, isStaff, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (tab === "sign-in") {
        await login(email, password);
      } else {
        await register({ name, email, password });
      }
      navigate("/", { replace: true });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSelectPreset = (presetEmail) => {
    setEmail(presetEmail);
    setError(null);
  };

  return (
    <div className="flex min-h-screen bg-[#F8FAFC]" data-testid={`${tab}-page`}>
      {/* Left branding panel */}
      <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-[#111827] p-12 lg:flex">
        <Logo brand={brand} dark />
        <div className="relative z-10">
          <h1 className="font-display text-5xl font-bold leading-[1.05] text-white">
            Every rupee,<br />
            <span className="text-[#B9F36B]">verified by the bank.</span>
          </h1>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-[#94A3B8]">
            Central payment verification, collection monitoring and automated reconciliation for the Route39 EV fleet.
            Bank-confirmed money, zero manual leakage.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4 text-[11px] text-[#94A3B8]">
          {["Bank-verified only", "Idempotent ledger", "Audit everything"].map((t) => (
            <div key={t} className="border-t border-white/10 pt-3">{t}</div>
          ))}
        </div>
        <div className="pointer-events-none absolute -right-24 top-1/3 h-80 w-80 rounded-full border-[40px] border-[#B9F36B]/10" />
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="mb-8 text-center lg:text-left">
            <div className="inline-flex lg:hidden mb-4">
              <Logo brand={brand} />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-[#111827]">
              {tab === "sign-in" ? "Sign in to Rupay39" : "Create an account"}
            </h2>
            <p className="mt-1.5 text-sm text-slate-500">
              {tab === "sign-in"
                ? "Enter your credentials to access the payment console"
                : "Register for access to Route39 payment management"}
            </p>
          </div>

          {/* Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            {/* Tab switch */}
            <div className="flex border-b border-slate-200 mb-6">
              <button
                type="button"
                className={`flex-1 pb-3 text-sm font-semibold border-b-2 transition-colors ${
                  tab === "sign-in"
                    ? "border-[#111827] text-[#111827]"
                    : "border-transparent text-slate-400 hover:text-slate-700"
                }`}
                onClick={() => { setTab("sign-in"); setError(null); }}
                data-testid="tab-sign-in"
              >
                Sign In
              </button>
              <button
                type="button"
                className={`flex-1 pb-3 text-sm font-semibold border-b-2 transition-colors ${
                  tab === "sign-up"
                    ? "border-[#111827] text-[#111827]"
                    : "border-transparent text-slate-400 hover:text-slate-700"
                }`}
                onClick={() => { setTab("sign-up"); setError(null); }}
                data-testid="tab-sign-up"
              >
                Register
              </button>
            </div>

            {error && (
              <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs text-red-700">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-500" />
                <div className="leading-snug">{error}</div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {tab === "sign-up" && (
                <div className="space-y-1.5">
                  <Label htmlFor="auth-name" className="text-xs font-semibold text-slate-700">Full Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      id="auth-name"
                      type="text"
                      placeholder="e.g. Anand Kumar"
                      className="pl-9"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      data-testid="register-name-input"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="auth-email" className="text-xs font-semibold text-slate-700">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    id="auth-email"
                    type="email"
                    placeholder="name@route39.in"
                    className="pl-9"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    data-testid={tab === "sign-in" ? "login-email-input" : "register-email-input"}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="auth-password" className="text-xs font-semibold text-slate-700">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    id="auth-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    className="pl-9 pr-9"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    data-testid={tab === "sign-in" ? "login-password-input" : "register-password-input"}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full bg-[#111827] hover:bg-[#1f2937] text-white font-medium h-10 mt-2"
                disabled={submitting}
                data-testid={tab === "sign-in" ? "login-submit-button" : "register-submit-button"}
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {tab === "sign-in" ? "Signing In..." : "Creating Account..."}
                  </span>
                ) : (
                  tab === "sign-in" ? "Sign In" : "Register Account"
                )}
              </Button>
            </form>

            {/* Quick account presets (pre-fills email only - no hardcoded default passwords) */}
            {tab === "sign-in" && (
              <div className="mt-6 pt-5 border-t border-slate-100">
                <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium mb-2.5">
                  <Shield className="h-3.5 w-3.5 text-slate-400" />
                  <span>Quick Select Account (Selects email):</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {PRESET_ACCOUNTS.map((acc) => (
                    <button
                      key={acc.email}
                      type="button"
                      onClick={() => handleSelectPreset(acc.email)}
                      className="p-2 text-left rounded-lg border border-slate-200 text-xs hover:border-[#111827] hover:bg-slate-50 transition-all group"
                      title={acc.email}
                    >
                      <div className="font-semibold text-slate-900 group-hover:text-black truncate">
                        {acc.label}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">{acc.role}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

