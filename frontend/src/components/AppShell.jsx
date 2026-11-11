import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { UserButton } from "@clerk/react";
import {
  LayoutDashboard, Receipt, FileClock, Landmark, GitCompareArrows, AlertTriangle, Wallet, Users, Truck, FileBarChart,
  ShieldCheck, Plug, Network, ScrollText, Settings, Menu, X,
} from "lucide-react";
import { useMe } from "../context/MeContext";

const NAV = [
  ["/", "Dashboard", LayoutDashboard, "staff"], ["/payments", "Payments", Receipt, "staff"], ["/requests", "Payment Requests", FileClock, "staff"],
  ["/bank", "Bank Transactions", Landmark, "finance"], ["/reconciliation", "Reconciliation", GitCompareArrows, "finance"],
  ["/exceptions", "Unmatched Payments", AlertTriangle, "staff"], ["/settlements", "Settlements", Wallet, "finance"],
  ["/drivers", "Drivers", Users, "staff"], ["/vehicles", "Vehicles", Truck, "staff"], ["/reports", "Reports", FileBarChart, "finance"],
  ["/supervisors", "Supervisors", ShieldCheck, "super"], ["/providers", "Payment Providers", Plug, "finance"],
  ["/integrations", "API Integrations", Network, "finance"], ["/audit", "Audit Logs", ScrollText, "super"], ["/settings", "Settings", Settings, "finance"],
];

export const Logo = ({ brand, dark }) => (
  <div className="flex items-center gap-2.5" data-testid="brand-logo">
    {brand.logo_url ? <img src={brand.logo_url} alt="" className="h-8 w-8 rounded object-contain" /> : (
      <div className="grid h-8 w-8 place-items-center rounded-md bg-[#B9F36B] font-display text-sm font-bold text-[#111827]">₹</div>
    )}
    <div className="leading-tight">
      <div className={`font-display text-lg font-bold tracking-tight ${dark ? "text-white" : "text-[#111827]"}`}>{brand.brand_name}</div>
      <div className="text-[9px] font-semibold tracking-[0.2em] text-[#94A3B8]">{brand.brand_tagline}</div>
    </div>
  </div>
);

function Sidebar({ onNavigate }) {
  const { brand, isSuper, isFinance } = useMe();
  const allowed = (lvl) => lvl === "staff" || (lvl === "finance" && isFinance) || (lvl === "super" && isSuper);
  return (
    <aside className="flex h-full w-64 flex-col bg-[#111827]">
      <div className="px-5 py-5"><Logo brand={brand} dark /></div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-6">
        {NAV.filter((n) => allowed(n[3])).map(([to, name, Icon]) => (
          <NavLink key={to} to={to} end={to === "/"} onClick={onNavigate} data-testid={`nav-${name.toLowerCase().replace(/ /g, "-")}`}
            className={({ isActive }) => `flex items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors ${isActive ? "bg-[#1F2937] font-semibold text-white shadow-[inset_-2px_0_0_#B9F36B]" : "text-[#94A3B8] hover:bg-[#1F2937]/70 hover:text-white"}`}>
            <Icon className="h-4 w-4" />{name}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/5 px-5 py-3 text-[10px] text-[#64748B]">Route39 Mobility · v1.0</div>
    </aside>
  );
}

export default function AppShell() {
  const { me } = useMe();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen bg-[#F8FAFC]">
      <div className="no-print sticky top-0 hidden h-screen lg:block"><Sidebar /></div>
      {open && (
        <div className="no-print fixed inset-0 z-50 flex lg:hidden">
          <Sidebar onNavigate={() => setOpen(false)} />
          <button className="flex-1 bg-black/40" onClick={() => setOpen(false)} data-testid="close-mobile-nav" aria-label="Close menu" />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[#E2E8F0] bg-white/80 px-4 backdrop-blur-md sm:px-6">
          <button className="lg:hidden" onClick={() => setOpen(true)} data-testid="open-mobile-nav" aria-label="Menu">{open ? <X /> : <Menu />}</button>
          <div className="hidden text-xs text-slate-500 lg:block">Payment verification & reconciliation console</div>
          <div className="flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="text-xs font-semibold" data-testid="header-user-email">{me?.email}</div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#4d7c0f]" data-testid="header-role-badge">{me?.role_label}</div>
            </div>
            <UserButton />
          </div>
        </header>
        <main className="print-area flex-1 space-y-6 p-4 sm:p-6 lg:p-8"><Outlet /></main>
      </div>
    </div>
  );
}
