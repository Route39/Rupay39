import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Show, SignIn, SignUp, useClerk } from "@clerk/react";
import { Loader2, Lock } from "lucide-react";
import ClerkAuthProvider from "@/components/auth/ClerkAuthProvider";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { MeProvider, useMe, useBranding } from "@/context/MeContext";
import AppShell, { Logo } from "@/components/AppShell";
import Dashboard from "@/pages/Dashboard";
import Payments from "@/pages/Payments";
import PaymentRequests from "@/pages/PaymentRequests";
import PaymentDetail from "@/pages/PaymentDetail";
import BankTransactions from "@/pages/BankTransactions";
import Reconciliation from "@/pages/Reconciliation";
import Exceptions from "@/pages/Exceptions";
import Settlements from "@/pages/Settlements";
import Drivers from "@/pages/Drivers";
import Vehicles from "@/pages/Vehicles";
import Reports from "@/pages/Reports";
import Supervisors from "@/pages/Supervisors";
import Providers from "@/pages/Providers";
import Integrations from "@/pages/Integrations";
import AuditLogs from "@/pages/AuditLogs";
import SettingsPage from "@/pages/SettingsPage";
import ReceiptPage from "@/pages/ReceiptPage";

function AuthLayout({ children }) {
  const brand = useBranding();
  return (
    <div className="flex min-h-screen bg-[#F8FAFC]">
      <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-[#111827] p-12 lg:flex">
        <Logo brand={brand} dark />
        <div className="relative z-10">
          <h1 className="font-display text-5xl font-bold leading-[1.05] text-white">Every rupee,<br /><span className="text-[#B9F36B]">verified by the bank.</span></h1>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-[#94A3B8]">Central payment verification, collection monitoring and reconciliation for the Route39 EV fleet. No screenshots. Only bank-confirmed money.</p>
        </div>
        <div className="grid grid-cols-3 gap-4 text-[11px] text-[#94A3B8]">
          {["Bank-verified only", "Idempotent ledger", "Audit everything"].map((t) => <div key={t} className="border-t border-white/10 pt-3">{t}</div>)}
        </div>
        <div className="pointer-events-none absolute -right-24 top-1/3 h-80 w-80 rounded-full border-[40px] border-[#B9F36B]/10" />
      </div>
      <div className="flex flex-1 items-center justify-center p-6">{children}</div>
    </div>
  );
}

function Guard({ need, children }) {
  const { isSuper, isFinance } = useMe();
  const ok = need === "super" ? isSuper : isFinance;
  if (ok) return children;
  return (
    <div className="mx-auto max-w-md py-20 text-center" data-testid="access-denied">
      <Lock className="mx-auto h-8 w-8 text-slate-400" />
      <h2 className="mt-4 text-lg font-semibold">Access restricted</h2>
      <p className="mt-1 text-sm text-slate-500">Your role does not have access to this section.</p>
    </div>
  );
}
const F = (el) => <Guard need="finance">{el}</Guard>;
const S = (el) => <Guard need="super">{el}</Guard>;

function Gate() {
  const { me, loading, error, isStaff } = useMe();
  const { signOut } = useClerk();
  if (loading && !me) return <div className="grid min-h-screen place-items-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  if (error || !isStaff) {
    return (
      <AuthLayout>
        <div className="max-w-sm text-center" data-testid="pending-access">
          <Lock className="mx-auto h-8 w-8 text-slate-400" />
          <h2 className="mt-4 text-xl font-semibold">Access pending approval</h2>
          <p className="mt-2 text-sm text-slate-500">{error || `Signed in as ${me?.email}. A Super Admin must assign you a role (Supervisor or Finance Admin) before you can view financial data.`}</p>
          <Button className="mt-6" variant="outline" onClick={() => signOut()} data-testid="pending-signout-btn">Sign out</Button>
        </div>
      </AuthLayout>
    );
  }
  return (
    <Routes>
      <Route path="/receipts/:no" element={<ReceiptPage />} />
      <Route element={<AppShell />}>
        <Route index element={<Dashboard />} />
        <Route path="payments" element={<Payments />} />
        <Route path="requests" element={<PaymentRequests />} />
        <Route path="requests/:id" element={<PaymentDetail />} />
        <Route path="bank" element={F(<BankTransactions />)} />
        <Route path="reconciliation" element={F(<Reconciliation />)} />
        <Route path="exceptions" element={<Exceptions />} />
        <Route path="settlements" element={F(<Settlements />)} />
        <Route path="drivers" element={<Drivers />} />
        <Route path="vehicles" element={<Vehicles />} />
        <Route path="reports" element={F(<Reports />)} />
        <Route path="supervisors" element={S(<Supervisors />)} />
        <Route path="providers" element={F(<Providers />)} />
        <Route path="integrations" element={F(<Integrations />)} />
        <Route path="audit" element={S(<AuditLogs />)} />
        <Route path="settings" element={F(<SettingsPage />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function Protected() {
  return (
    <>
      <Show when="signed-in"><MeProvider><Gate /></MeProvider></Show>
      <Show when="signed-out"><Navigate to="/sign-in" replace /></Show>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ClerkAuthProvider>
        <Routes>
          <Route path="/sign-in/*" element={<AuthLayout><SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" withSignUp /></AuthLayout>} />
          <Route path="/sign-up/*" element={<AuthLayout><SignUp routing="path" path="/sign-up" signInUrl="/sign-in" /></AuthLayout>} />
          <Route path="/*" element={<Protected />} />
        </Routes>
      </ClerkAuthProvider>
      <Toaster position="top-right" richColors />
    </BrowserRouter>
  );
}
