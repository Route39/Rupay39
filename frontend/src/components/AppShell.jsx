import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Receipt, FileClock, Landmark, GitCompareArrows, AlertTriangle, Wallet, Users, Truck, FileBarChart,
  ShieldCheck, Plug, Network, ScrollText, Settings, LogOut, Link2, MoreHorizontal, Menu, X,
} from "lucide-react";
import { useMe } from "../context/MeContext";
import { Button } from "@/components/ui/button";

const NAV = [
  ["/", "Dashboard", LayoutDashboard, "staff"],
  ["/payment-links", "Payment Links", Link2, "staff"],
  ["/payments", "Payments", Receipt, "staff"],
  ["/requests", "Payment Requests", FileClock, "staff"],
  ["/bank", "Bank Transactions", Landmark, "finance"], ["/reconciliation", "Reconciliation", GitCompareArrows, "finance"],
  ["/exceptions", "Unmatched Payments", AlertTriangle, "staff"], ["/settlements", "Settlements", Wallet, "finance"],
  ["/drivers", "Drivers", Users, "staff"], ["/vehicles", "Vehicles", Truck, "staff"], ["/reports", "Reports", FileBarChart, "finance"],
  ["/supervisors", "Supervisors", ShieldCheck, "super"], ["/providers", "Payment Providers", Plug, "finance"],
  ["/integrations", "API Integrations", Network, "finance"], ["/audit", "Audit Logs", ScrollText, "super"], ["/settings", "Settings", Settings, "finance"],
];

// Mobile bottom bar: these 4 + "More"; everything else lives in the More sheet.
const PRIMARY = { "/": "Home", "/payments": "Payments", "/requests": "Requests", "/payment-links": "Links" };

const useAllowed = () => {
  const { isSuper, isFinance } = useMe();
  return (lvl) => lvl === "staff" || (lvl === "finance" && isFinance) || (lvl === "super" && isSuper);
};

export const Logo = ({ brand, dark }) => (
  <div className="flex items-center gap-2.5" data-testid="brand-logo">
    {brand?.logo_url ? <img src={brand.logo_url} alt="" className="h-8 w-8 rounded object-contain" /> : (
      <div className="grid h-8 w-8 place-items-center rounded-md bg-[#B9F36B] font-display text-sm font-bold text-[#111827]">₹</div>
    )}
    <div className="leading-tight">
      <div className={`font-display text-lg font-bold tracking-tight ${dark ? "text-white" : "text-[#111827]"}`}>{brand?.brand_name || "RUPAY39"}</div>
      <div className="text-[9px] font-semibold tracking-[0.2em] text-[#94A3B8]">{brand?.brand_tagline || "POWERED BY ROUTE39"}</div>
    </div>
  </div>
);

function Sidebar({ onNavigate }) {
  const { brand } = useMe();
  const allowed = useAllowed();
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

const TabIcon = ({ Icon, active, text }) => (
  <>
    <span className={`grid h-7 w-12 place-items-center rounded-full transition-colors ${active ? "bg-[#B9F36B] text-[#111827]" : ""}`}><Icon className="h-[18px] w-[18px]" /></span>
    <span className={active ? "font-semibold text-[#111827]" : ""}>{text}</span>
  </>
);

function BottomNav() {
  const allowed = useAllowed();
  const { pathname } = useLocation();
  const [more, setMore] = useState(false);
  const items = NAV.filter((n) => allowed(n[3]));
  const primary = items.filter(([to]) => PRIMARY[to]);
  const rest = items.filter(([to]) => !PRIMARY[to]);
  const moreActive = more || rest.some(([to]) => pathname.startsWith(to));
  const tab = "flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] font-medium text-slate-500";
  return (
    <>
      {more && (
        <div className="no-print fixed inset-0 z-50 lg:hidden" onClick={() => setMore(false)} data-testid="more-sheet">
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute inset-x-0 bottom-0 max-h-[75vh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-200" />
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {rest.map(([to, name, Icon]) => (
                <NavLink key={to} to={to} onClick={() => setMore(false)} data-testid={`more-${name.toLowerCase().replace(/ /g, "-")}`}
                  className={({ isActive }) => `flex flex-col items-center gap-1.5 rounded-xl p-3 text-center text-[11px] font-medium ${isActive ? "bg-[#B9F36B] text-[#111827]" : "bg-slate-50 text-slate-600"}`}>
                  <Icon className="h-5 w-5" />{name}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}
      <nav className="no-print fixed inset-x-0 bottom-0 z-40 flex border-t border-[#E2E8F0] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden" data-testid="bottom-nav">
        {primary.map(([to, , Icon]) => (
          <NavLink key={to} to={to} end={to === "/"} onClick={() => setMore(false)} className={tab} data-testid={`tab-${PRIMARY[to].toLowerCase()}`}>
            {({ isActive }) => <TabIcon Icon={Icon} active={isActive && !more} text={PRIMARY[to]} />}
          </NavLink>
        ))}
        {rest.length > 0 && (
          <button type="button" onClick={() => setMore((m) => !m)} className={tab} data-testid="tab-more">
            <TabIcon Icon={MoreHorizontal} active={moreActive} text="More" />
          </button>
        )}
      </nav>
    </>
  );
}

export default function AppShell() {
  const { me, brand, logout } = useMe();
  const [open, setOpen] = useState(false);
  const initial = (me?.name || me?.email || "U").charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen bg-[#F8FAFC]">
      <div className="no-print sticky top-0 hidden h-screen lg:block"><Sidebar /></div>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[#E2E8F0] bg-white/80 px-4 backdrop-blur-md sm:px-6">
          <div className="flex items-center gap-2 lg:hidden"><button type="button" onClick={() => setOpen(true)} className="grid h-9 w-9 place-items-center rounded-md text-slate-700 hover:bg-slate-100" data-testid="menu-btn" aria-label="Open menu"><Menu className="h-5 w-5" /></button><Logo brand={brand} /></div>
          <div className="hidden text-xs text-slate-500 lg:block">Payment verification & reconciliation console</div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-xs font-semibold" data-testid="header-user-email">{me?.email}</div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#4d7c0f]" data-testid="header-role-badge">{me?.role_label || me?.role}</div>
            </div>
            <div className="grid h-8 w-8 place-items-center rounded-full bg-[#111827] text-xs font-bold text-white shadow-sm">{initial}</div>
            <Button variant="ghost" size="icon" onClick={logout} title="Sign out"
              className="h-8 w-8 text-slate-500 hover:bg-red-50 hover:text-red-600" data-testid="header-signout-btn">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <main className="print-area flex-1 space-y-6 p-4 pb-28 sm:p-6 sm:pb-28 lg:p-8"><Outlet /></main>
      </div>
      {open && (
        <div className="no-print fixed inset-0 z-50 lg:hidden" data-testid="mobile-drawer">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 shadow-xl">
            <button type="button" onClick={() => setOpen(false)} className="absolute right-2 top-4 z-10 grid h-8 w-8 place-items-center rounded-md text-slate-300 hover:bg-white/10" aria-label="Close menu"><X className="h-4 w-4" /></button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
      <BottomNav />
    </div>
  );
}
