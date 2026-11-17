import React, { useState, useEffect } from "react";
import { 
  Plus, 
  Copy, 
  ExternalLink, 
  QrCode, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Zap, 
  RefreshCw,
  Search,
  Check,
  Send,
  ChevronDown,
  ChevronUp,
  Landmark,
  ShieldCheck,
  FileText,
  Calendar,
  CreditCard,
  Building,
  HelpCircle,
  X,
  Code2,
  Settings as SettingsIcon,
  PiggyBank,
  Users,
  Briefcase,
  TrendingUp,
  ArrowUpRight
} from "lucide-react";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { StatusBadge, SimBadge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { inr, dt } from "@/lib/format";
import { useMe } from "@/context/MeContext";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || (typeof window !== "undefined" && window.location.hostname === "localhost" ? "http://localhost:8010" : "");
const API_BASE = `${BACKEND_URL}/api`;

export default function PaymentLinks() {
  const { isFinance } = useMe();
  const [orders, setOrders] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("ALL"); // ALL, PENDING, PARTIALLY_PAID, SUCCESS, CANCELLED
  const [accountFilter, setAccountFilter] = useState("ALL"); // ALL, DRIVER, INVESTOR
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editAccountsOpen, setEditAccountsOpen] = useState(false);
  const [qrModalOrder, setQrModalOrder] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);
  const [showJsonFor, setShowJsonFor] = useState(null);

  // Accounts Form
  const [accountsForm, setAccountsForm] = useState({
    driver_vpa: "route39mobility@kotak",
    driver_account_name: "Route39 Driver Operations",
    investor_vpa: "route39investors@kotak",
    investor_account_name: "Route39 Investor Distributions",
  });
  const [savingAccounts, setSavingAccounts] = useState(false);

  // New Link Form State
  const [form, setForm] = useState({
    amount: "450",
    purpose: "Route39 EV Rental & Swapping",
    customer_name: "",
    customer_phone: "",
    driver_id: "",
    account_type: "DRIVER",
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchSummary = async () => {
    try {
      const res = await fetch(`${API_BASE}/checkout/summary`);
      if (res.ok) {
        const data = await res.json();
        setSummary(data);
      }
    } catch {
      // ignore
    }
  };

  const fetchAccounts = async () => {
    try {
      const res = await fetch(`${API_BASE}/checkout/accounts`);
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
        if (data.accounts?.length) {
          const drv = data.accounts.find(a => a.type === "DRIVER");
          const inv = data.accounts.find(a => a.type === "INVESTOR");
          setAccountsForm({
            driver_vpa: drv?.vpa || "route39mobility@kotak",
            driver_account_name: drv?.name || "Route39 Driver Operations",
            investor_vpa: inv?.vpa || "route39investors@kotak",
            investor_account_name: inv?.name || "Route39 Investor Distributions",
          });
        }
      }
    } catch {
      // ignore
    }
  };

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/checkout/orders?limit=50`);
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
      }
    } catch {
      toast.error("Failed to load payment links");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    fetchAccounts();
    fetchSummary();
  }, []);

  const handleSaveAccounts = async (e) => {
    e.preventDefault();
    setSavingAccounts(true);
    try {
      const res = await fetch(`${API_BASE}/checkout/accounts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accountsForm),
      });
      if (!res.ok) throw new Error("Failed to update accounts configuration");
      toast.success("Bank accounts & UPI IDs updated successfully!");
      setEditAccountsOpen(false);
      await fetchAccounts();
      await fetchOrders();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingAccounts(false);
    }
  };

  const handleCreateLink = async (e) => {
    e.preventDefault();
    if (!form.amount || Number(form.amount) <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/checkout/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: parseFloat(form.amount),
          purpose: form.purpose || "Route39 Fleet Payment",
          customer_name: form.customer_name || (form.account_type === "INVESTOR" ? "Route39 Investor" : "Route39 Driver"),
          customer_phone: form.customer_phone || null,
          driver_id: form.driver_id || null,
          account_type: form.account_type || "DRIVER",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to create payment link");
      toast.success(`Payment link created for ${data.account_type} Account: ${data.order_id}`);
      setCreateOpen(false);
      setForm({
        amount: "450",
        purpose: "Route39 EV Rental & Swapping",
        customer_name: "",
        customer_phone: "",
        driver_id: "",
        account_type: "DRIVER",
      });
      await fetchOrders();
      await fetchSummary();
      setQrModalOrder(data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = (orderId) => {
    const link = `${window.location.origin}/pay/${orderId}`;
    navigator.clipboard.writeText(link);
    setCopiedId(orderId);
    toast.success("Payment link copied to clipboard!");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const shareWhatsApp = (order) => {
    const link = `${window.location.origin}/pay/${order.order_id}`;
    const text = encodeURIComponent(
      `Hello ${order.customer_name || "Customer"}, here is your Route39 payment link for ${order.purpose}: ${inr(order.amount)}. Pay instantly via UPI (GPay/PhonePe/Paytm): ${link}`
    );
    window.open(`https://wa.me/${order.customer_phone ? order.customer_phone.replace(/[^0-9]/g, "") : ""}?text=${text}`, "_blank");
  };

  const handleSimulatePay = async (orderId) => {
    try {
      const res = await fetch(`${API_BASE}/checkout/orders/${orderId}/simulate-pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Simulation failed");
      toast.success(`Payment confirmed instantly! Receipt #${data.receipt_no}`);
      await fetchOrders();
      await fetchSummary();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggleRow = (orderId) => {
    setExpandedRow((prev) => (prev === orderId ? null : orderId));
  };

  // Filtered orders
  const filtered = orders.filter((o) => {
    if (activeTab === "CREATED" && o.status !== "PENDING") return false;
    if (activeTab === "PARTIALLY_PAID" && o.status !== "PARTIALLY_PAID") return false;
    if (activeTab === "PAID" && o.status !== "SUCCESS") return false;
    if (activeTab === "CANCELLED" && o.status !== "EXPIRED" && o.status !== "FAILED") return false;
    if (accountFilter !== "ALL" && o.account_type !== accountFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        (o.order_id && o.order_id.toLowerCase().includes(q)) ||
        (o.internal_ref && o.internal_ref.toLowerCase().includes(q)) ||
        (o.customer_name && o.customer_name.toLowerCase().includes(q)) ||
        (o.purpose && o.purpose.toLowerCase().includes(q)) ||
        (o.receipt_no && o.receipt_no.toLowerCase().includes(q)) ||
        (o.utr && o.utr.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div className="space-y-5 max-w-full overflow-hidden">
      {/* 1. TOP ANNOUNCEMENT BANNER (Responsive Stack on Mobile) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between rounded-xl bg-gradient-to-r from-[#4338CA] via-[#4F46E5] to-[#3B82F6] p-3.5 sm:px-5 sm:py-3 text-white shadow-md gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-white/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider backdrop-blur-sm">
            Auto-send Payment Receipts
          </span>
          <span className="text-xs font-medium text-indigo-100">
            Build trust with every transaction · Real-time SMS & WhatsApp alerts
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs font-semibold text-white/95">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
          0% Gateway Commission · Direct Kotak Bank Credit
        </div>
      </div>

      {/* 2. 0% COMMISSION SAVINGS & VOLUME TRACKER (Responsive 4-Cards Grid) */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Total Volume */}
          <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Volume Collected</div>
            <div className="mt-1 font-mono text-base sm:text-lg font-black text-slate-900">{inr(summary.total_volume)}</div>
            <div className="mt-0.5 text-[10px] text-slate-500 font-medium">{summary.count_paid} Transactions Settled</div>
          </div>

          {/* Razorpay 2% Cut Avoided (SAVED!) */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1">
              <PiggyBank className="h-3 w-3" /> Razorpay 2% Cut Avoided
            </div>
            <div className="mt-1 font-mono text-base sm:text-lg font-black text-emerald-700">+{inr(summary.commission_saved)}</div>
            <div className="mt-0.5 text-[10px] text-emerald-700 font-semibold">100% saved in your Kotak A/C</div>
          </div>

          {/* Driver Ops Balance */}
          <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <Users className="h-3 w-3 text-emerald-600" /> Driver Ops Volume
            </div>
            <div className="mt-1 font-mono text-base sm:text-lg font-black text-slate-900">{inr(summary.driver_volume)}</div>
            <div className="mt-0.5 text-[10px] text-slate-500">Rent, swaps & driver payouts</div>
          </div>

          {/* Investor Capital Volume */}
          <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <Briefcase className="h-3 w-3 text-indigo-600" /> Investor Capital Volume
            </div>
            <div className="mt-1 font-mono text-base sm:text-lg font-black text-slate-900">{inr(summary.investor_volume)}</div>
            <div className="mt-0.5 text-[10px] text-slate-500">Vehicle financing & ROI payouts</div>
          </div>
        </div>
      )}

      {/* 3. DUAL ACCOUNT ROUTING CARDS (DRIVER & INVESTOR) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
        {/* Account 1: Driver Operations */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5 shadow-sm hover:shadow-md transition">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                <Users className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h3 className="text-sm font-bold text-slate-900 truncate">Driver Operations Account</h3>
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-800">
                    A/C 1 · Live
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 sm:truncate">Rent collections, swaps & driver payouts</p>
              </div>
            </div>
            <span className="shrink-0 font-mono text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              0% Fee
            </span>
          </div>

          <div className="mt-3.5 rounded-xl bg-slate-50 p-2.5 sm:p-3 text-xs space-y-1.5 border border-slate-100">
            <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-3">
              <span className="text-slate-500">Merchant UPI ID:</span>
              <span className="font-mono font-bold text-slate-900 break-all sm:text-right">
                {accountsForm.driver_vpa}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-3">
              <span className="text-slate-500">Bank & A/C:</span>
              <span className="font-medium text-slate-700">Kotak Mahindra Bank (•••• 3901)</span>
            </div>
            <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-3">
              <span className="text-slate-500">Settlement SLA:</span>
              <span className="font-bold text-emerald-600">Real-Time T+0 (0s Delay)</span>
            </div>
          </div>
        </div>

        {/* Account 2: Investor Payouts & Capital */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5 shadow-sm hover:shadow-md transition">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
                <Briefcase className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h3 className="text-sm font-bold text-slate-900 truncate">Investor Payouts & Capital</h3>
                  <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[9px] font-bold text-indigo-800">
                    A/C 2 · Live
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 sm:truncate">Vehicle financing, ROI & investor yields</p>
              </div>
            </div>
            <span className="shrink-0 font-mono text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
              0% Fee
            </span>
          </div>

          <div className="mt-3.5 rounded-xl bg-slate-50 p-2.5 sm:p-3 text-xs space-y-1.5 border border-slate-100">
            <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-3">
              <span className="text-slate-500">Investor UPI ID:</span>
              <span className="font-mono font-bold text-slate-900 break-all sm:text-right">
                {accountsForm.investor_vpa}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-3">
              <span className="text-slate-500">Bank & A/C:</span>
              <span className="font-medium text-slate-700">Kotak Mahindra Bank (•••• 5822)</span>
            </div>
            <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-3">
              <span className="text-slate-500">Settlement SLA:</span>
              <span className="font-bold text-indigo-600">Real-Time T+0 (0s Delay)</span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. HERO SECTION */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="max-w-xl space-y-1.5">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-emerald-800">
              <PiggyBank className="h-3 w-3" /> Independent Gateway · 0% Commission
            </div>
            <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900">
              Direct Bank UPI Settlement · Save 2% on Every Rupee
            </h2>
            <p className="text-xs leading-relaxed text-slate-600">
              Razorpay charges <strong>2% + 18% GST</strong> on every transaction. With Rupay39, money goes <strong>Directly into your Kotak Bank Account in 0 seconds</strong> with zero third-party commissions.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              variant="outline"
              onClick={() => setEditAccountsOpen(true)}
              className="flex items-center gap-1.5 border-slate-200 text-xs font-semibold h-9 px-3"
            >
              <SettingsIcon className="h-3.5 w-3.5 text-slate-500" /> Configure Real UPI IDs
            </Button>
            <Button
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-2 bg-[#2563EB] text-white hover:bg-[#1D4ED8] font-bold shadow-md shadow-blue-500/20 text-xs h-9 px-4"
            >
              <Plus className="h-4 w-4" /> Create Payment Link
            </Button>
          </div>
        </div>
      </div>

      {/* 5. SUB-TABS & ACCOUNT FILTER (Smooth Horizontal Scroll on Mobile) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-200 pb-3 gap-3">
        {/* Status Tabs */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-6 text-xs font-semibold">
          {[
            { id: "ALL", label: "All Links", count: orders.length },
            { id: "CREATED", label: "Created / Pending", count: orders.filter(o => o.status === "PENDING").length },
            { id: "PARTIALLY_PAID", label: "Partially Paid", count: orders.filter(o => o.status === "PARTIALLY_PAID").length },
            { id: "PAID", label: "Paid", count: orders.filter(o => o.status === "SUCCESS").length },
            { id: "CANCELLED", label: "Cancelled", count: orders.filter(o => o.status === "EXPIRED" || o.status === "FAILED").length },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative pb-1.5 whitespace-nowrap transition ${
                  isActive
                    ? "text-[#2563EB] font-bold border-b-2 border-[#2563EB]"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                <span>{tab.label}</span>
                <span className={`ml-1.5 rounded-full px-1.5 py-0.2 text-[10px] ${
                  isActive ? "bg-blue-100 text-[#2563EB]" : "bg-slate-100 text-slate-600"
                }`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Account Filter Pill */}
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
          <span className="text-xs text-slate-500 font-medium whitespace-nowrap">Filter Account:</span>
          <div className="grid grid-cols-3 items-stretch sm:inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs sm:whitespace-nowrap">
            <button
              onClick={() => setAccountFilter("ALL")}
              className={`rounded-md px-1.5 py-1.5 text-center leading-tight text-[11px] font-semibold transition sm:px-2.5 sm:py-1 ${
                accountFilter === "ALL" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              All Accounts
            </button>
            <button
              onClick={() => setAccountFilter("DRIVER")}
              className={`rounded-md px-1.5 py-1.5 text-center leading-tight text-[11px] font-semibold transition sm:px-2.5 sm:py-1 ${
                accountFilter === "DRIVER" ? "bg-emerald-600 text-white" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Driver Ops
            </button>
            <button
              onClick={() => setAccountFilter("INVESTOR")}
              className={`rounded-md px-1.5 py-1.5 text-center leading-tight text-[11px] font-semibold transition sm:px-2.5 sm:py-1 ${
                accountFilter === "INVESTOR" ? "bg-indigo-600 text-white" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Investor Capital
            </button>
          </div>
        </div>
      </div>

      {/* 6. SEARCH & REFRESH */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-80">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <Input
              type="text"
              placeholder="Search Link ID, Driver, UTR..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-full rounded-lg pl-8 text-xs bg-white border-slate-200"
            />
          </div>
          <Button size="sm" variant="outline" onClick={fetchOrders} className="h-8 px-2.5 border-slate-200 shrink-0">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <div className="text-xs text-slate-500 whitespace-nowrap">
          Showing <strong>{filtered.length}</strong> links
        </div>
      </div>

      {/* 7a. MOBILE CARD LIST (phones only) */}
      <div className="space-y-2.5 sm:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-xs text-slate-400">
            No payment links found. Tap <strong>"Create Payment Link"</strong> above to generate one.
          </div>
        ) : filtered.map((order) => {
          const st = { SUCCESS: ["Paid", "bg-emerald-100 text-emerald-700"], PENDING: ["Pending", "bg-amber-100 text-amber-700"],
            PARTIALLY_PAID: ["Partially Paid", "bg-blue-100 text-blue-700"], EXPIRED: ["Expired", "bg-red-100 text-red-700"],
            FAILED: ["Failed", "bg-red-100 text-red-700"] }[order.status] || [order.status, "bg-slate-100 text-slate-600"];
          const inv = order.account_type === "INVESTOR";
          const btn = "flex flex-1 flex-col items-center gap-0.5 rounded-lg border py-1.5 text-[10px] font-semibold transition";
          return (
            <div key={order.order_id} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm" data-testid={`link-card-${order.order_id}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="break-all font-mono text-xs font-bold text-slate-900">{order.order_id}</span>
                    <SimBadge show={order.is_simulated} />
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{dt(order.created_at)}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-sm font-bold text-slate-900">{inr(order.amount)}</div>
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${st[1]}`}>{st[0]}</span>
                </div>
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px]">
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-800">{order.customer_name || "Route39 Driver"}</div>
                  <div className="truncate text-slate-400">{order.customer_phone || order.driver_id || "Direct"}{order.purpose ? ` · ${order.purpose}` : ""}</div>
                </div>
                <span className={`shrink-0 rounded border px-2 py-0.5 text-[10px] font-bold ${inv ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                  {inv ? "Investor" : "Driver"}
                </span>
              </div>
              {order.receipt_no && <div className="mt-1 font-mono text-[10px] font-semibold text-emerald-600">{order.receipt_no}</div>}
              <div className="mt-3 flex gap-1.5 border-t border-slate-100 pt-3">
                <button onClick={() => copyLink(order.order_id)} className={`${btn} border-slate-200 text-slate-600`}>
                  {copiedId === order.order_id ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}Copy
                </button>
                <button onClick={() => setQrModalOrder(order)} className={`${btn} border-slate-200 text-slate-600`}><QrCode className="h-4 w-4" />QR</button>
                <button onClick={() => shareWhatsApp(order)} className={`${btn} border-emerald-200 bg-emerald-50 text-emerald-700`}><Send className="h-4 w-4" />WhatsApp</button>
                <a href={`/pay/${order.order_id}`} target="_blank" rel="noreferrer" className={`${btn} border-[#111827] bg-[#111827] text-white`}><ExternalLink className="h-4 w-4" />Open</a>
                {order.status === "PENDING" && (
                  <button onClick={() => handleSimulatePay(order.order_id)} className={`${btn} border-[#B9F36B] bg-[#B9F36B] text-[#0B0F19]`}><Zap className="h-4 w-4" />Simulate</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 7. FULLY RESPONSIVE TABLE WITH EXPANDABLE LOGS (tablet & desktop) */}
      <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[700px] sm:min-w-full">
            <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
              <tr>
                <th className="w-8 px-3 py-3 text-center"></th>
                <th className="px-3 sm:px-4 py-3">Link ID</th>
                <th className="px-2 sm:px-3 py-3">Account</th>
                <th className="px-2 sm:px-3 py-3">Status</th>
                <th className="px-3 sm:px-4 py-3">Customer / Driver</th>
                <th className="px-3 sm:px-4 py-3">Purpose</th>
                <th className="px-3 sm:px-4 py-3 text-right">Amount</th>
                <th className="px-3 sm:px-4 py-3">Created</th>
                <th className="px-3 sm:px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    No payment links found matching criteria. Click <strong>"Create Payment Link"</strong> above to generate one.
                  </td>
                </tr>
              ) : (
                filtered.map((order) => {
                  const isExpanded = expandedRow === order.order_id;
                  const isPaid = order.status === "SUCCESS";
                  const isCreated = order.status === "PENDING";
                  const isInvestor = order.account_type === "INVESTOR";

                  return (
                    <React.Fragment key={order.order_id}>
                      {/* MAIN ROW */}
                      <tr 
                        onClick={() => toggleRow(order.order_id)} 
                        className={`cursor-pointer transition ${
                          isExpanded ? "bg-blue-50/40" : "hover:bg-slate-50/80"
                        }`}
                      >
                        <td className="px-3 py-3.5 text-center text-slate-400">
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 text-blue-600" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </td>

                        <td className="px-3 sm:px-4 py-3.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-bold text-slate-900 hover:text-blue-600">
                              {order.order_id}
                            </span>
                            <SimBadge show={order.is_simulated} />
                          </div>
                          <div className="font-mono text-[10px] text-slate-400">{order.internal_ref}</div>
                        </td>

                        <td className="px-2 sm:px-3 py-3.5 whitespace-nowrap">
                          {isInvestor ? (
                            <span className="inline-flex items-center gap-1 rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 border border-indigo-200">
                              <Briefcase className="h-3 w-3" /> Investor
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                              <Users className="h-3 w-3" /> Driver
                            </span>
                          )}
                        </td>

                        <td className="px-2 sm:px-3 py-3.5 whitespace-nowrap">
                          {isPaid ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                              <CheckCircle2 className="h-3 w-3" /> Paid
                            </span>
                          ) : isCreated ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-bold text-blue-700">
                              <Clock className="h-3 w-3" /> Created
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600">
                              <AlertCircle className="h-3 w-3" /> Cancelled
                            </span>
                          )}
                          {order.receipt_no && (
                            <div className="mt-0.5 font-mono text-[10px] text-emerald-600 font-semibold">
                              {order.receipt_no}
                            </div>
                          )}
                        </td>

                        <td className="px-3 sm:px-4 py-3.5">
                          <div className="font-medium text-slate-900">{order.customer_name || "Route39 Driver"}</div>
                          <div className="text-[11px] text-slate-400">{order.customer_phone || order.driver_id || "Direct"}</div>
                        </td>

                        <td className="px-3 sm:px-4 py-3.5 text-slate-600 max-w-[180px] sm:max-w-xs truncate">
                          {order.purpose}
                        </td>

                        <td className="px-3 sm:px-4 py-3.5 text-right font-mono font-bold text-slate-900 text-sm whitespace-nowrap">
                          {inr(order.amount)}
                        </td>

                        <td className="px-3 sm:px-4 py-3.5 text-slate-500 whitespace-nowrap text-[11px]">
                          {dt(order.created_at)}
                        </td>

                        <td className="px-3 sm:px-4 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => copyLink(order.order_id)}
                              title="Copy Payment Link"
                              className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 transition"
                            >
                              {copiedId === order.order_id ? (
                                <Check className="h-3.5 w-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>

                            <button
                              onClick={() => setQrModalOrder(order)}
                              title="View UPI QR Code"
                              className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 transition"
                            >
                              <QrCode className="h-3.5 w-3.5" />
                            </button>

                            <button
                              onClick={() => shareWhatsApp(order)}
                              title="Share on WhatsApp"
                              className="rounded-md border border-emerald-200 bg-emerald-50 p-1.5 text-emerald-700 hover:bg-emerald-100 transition"
                            >
                              <Send className="h-3.5 w-3.5" />
                            </button>

                            <a
                              href={`/pay/${order.order_id}`}
                              target="_blank"
                              rel="noreferrer"
                              title="Open Hosted Checkout"
                              className="rounded-md bg-[#111827] p-1.5 text-white hover:bg-slate-800 transition"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>

                            {order.status === "PENDING" && (
                              <button
                                onClick={() => handleSimulatePay(order.order_id)}
                                title="Simulate Instant Payment (Test)"
                                className="rounded-md bg-[#B9F36B] p-1.5 text-[#0B0F19] hover:bg-[#a6de57] font-bold transition"
                              >
                                <Zap className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* EXPANDED ACCORDION: UNDER EACH TO LOG DATA */}
                      {isExpanded && (
                        <tr className="bg-slate-50/90 border-b border-slate-200">
                          <td colSpan={9} className="p-3 sm:p-5">
                            <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm space-y-4">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                                <div>
                                  <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                                    <Landmark className="h-4 w-4 text-indigo-600" />
                                    Bank Settlement & Transaction Audit Logs ({order.account_type || "DRIVER"} ACCOUNT)
                                  </h4>
                                  <p className="text-[11px] text-slate-500">
                                    Real-time ledger events, Kotak NPCI UPI settlement, and cryptographic locks for #{order.order_id}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 border border-emerald-200">
                                    ✓ 0% Commission (Saved 2% vs Razorpay)
                                  </span>
                                  <button
                                    onClick={() => setShowJsonFor(showJsonFor === order.order_id ? null : order.order_id)}
                                    className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800 bg-slate-100 px-2 py-0.5 rounded"
                                  >
                                    <Code2 className="h-3 w-3" />
                                    {showJsonFor === order.order_id ? "Hide JSON" : "Raw JSON"}
                                  </button>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
                                <div className="rounded-lg bg-slate-50 p-2.5 sm:p-3 border border-slate-100">
                                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Receiving Account</div>
                                  <div className="mt-1 font-bold text-slate-800 text-xs truncate">
                                    {order.settlement_details?.account_name || "Route39 Mobility"}
                                  </div>
                                  <div className="text-[10px] text-slate-500 font-mono truncate">{order.vpa}</div>
                                </div>

                                <div className="rounded-lg bg-slate-50 p-2.5 sm:p-3 border border-slate-100">
                                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Gateway Commission</div>
                                  <div className="mt-1 font-bold text-emerald-600 text-xs flex items-center gap-1">
                                    <PiggyBank className="h-3 w-3" /> ₹0.00 (0% Fee)
                                  </div>
                                  <div className="text-[10px] text-emerald-700 font-semibold truncate">100% funds retained</div>
                                </div>

                                <div className="rounded-lg bg-slate-50 p-2.5 sm:p-3 border border-slate-100">
                                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Bank UTR / Ref</div>
                                  <div className="mt-1 font-mono font-bold text-slate-800 text-xs truncate">
                                    {order.utr || (order.status === "PENDING" ? "Awaiting Payer Confirmation" : "N/A")}
                                  </div>
                                  <div className="text-[10px] text-slate-500">NPCI 12-Digit Reference</div>
                                </div>

                                <div className="rounded-lg bg-slate-50 p-2.5 sm:p-3 border border-slate-100">
                                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Formal Tax Invoice</div>
                                  <div className="mt-1 font-mono font-bold text-indigo-600 text-xs truncate">
                                    {order.receipt_no ? (
                                      <a href={`/receipts/${order.receipt_no}`} target="_blank" rel="noreferrer" className="underline hover:text-indigo-800">
                                        {order.receipt_no}
                                      </a>
                                    ) : (
                                      "Pending Settlement"
                                    )}
                                  </div>
                                  <div className="text-[10px] text-slate-500">GST Compliant Voucher</div>
                                </div>
                              </div>

                              {/* Trail */}
                              <div className="space-y-1.5">
                                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Step-by-Step Activity & Security Trail</div>
                                <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 bg-white">
                                  {(order.audit_logs || []).map((log, idx) => (
                                    <div key={idx} className="flex items-start justify-between p-2.5 text-xs hover:bg-slate-50/50">
                                      <div className="flex items-start gap-2.5">
                                        <div className="mt-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 font-bold text-[9px] shrink-0">
                                          {idx + 1}
                                        </div>
                                        <div>
                                          <div className="font-mono font-bold text-slate-800 text-[10px]">{log.event}</div>
                                          <div className="text-slate-600 text-xs">{log.description}</div>
                                          <div className="mt-0.5 text-[9px] text-slate-400 font-mono">Actor: {log.actor} · State: {log.status}</div>
                                        </div>
                                      </div>
                                      <div className="font-mono text-[9px] text-slate-400 whitespace-nowrap ml-2">{dt(log.timestamp)}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {showJsonFor === order.order_id && (
                                <div className="rounded-lg bg-slate-900 p-3 text-slate-200 font-mono text-[10px] overflow-x-auto">
                                  <div className="text-[9px] text-slate-400 uppercase font-bold mb-1">Raw Audit Payload (JSON)</div>
                                  <pre>{JSON.stringify(order, null, 2)}</pre>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL 1: CREATE PAYMENT LINK (Fully Responsive) */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-white sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg font-bold">Create Dynamic Payment Link</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateLink} className="space-y-3.5 pt-2">
            <div>
              <Label className="text-xs font-semibold text-slate-700">Account Destination *</Label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, account_type: "DRIVER", purpose: "Route39 EV Rental & Swapping" })}
                  className={`rounded-xl border p-2.5 text-left text-xs transition ${
                    form.account_type === "DRIVER"
                      ? "border-emerald-500 bg-emerald-50/60 font-bold text-emerald-900 ring-2 ring-emerald-500/20"
                      : "border-slate-200 hover:bg-slate-50 text-slate-600"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold">
                    <Users className="h-3.5 w-3.5 text-emerald-600" /> Driver Operations
                  </div>
                  <div className="mt-1 text-[10px] text-slate-500">Rent, swaps & driver payouts</div>
                </button>

                <button
                  type="button"
                  onClick={() => setForm({ ...form, account_type: "INVESTOR", purpose: "Route39 Fleet Investment Capital" })}
                  className={`rounded-xl border p-2.5 text-left text-xs transition ${
                    form.account_type === "INVESTOR"
                      ? "border-indigo-500 bg-indigo-50/60 font-bold text-indigo-900 ring-2 ring-indigo-500/20"
                      : "border-slate-200 hover:bg-slate-50 text-slate-600"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold">
                    <Briefcase className="h-3.5 w-3.5 text-indigo-600" /> Investor Capital
                  </div>
                  <div className="mt-1 text-[10px] text-slate-500">Vehicle financing & ROI payouts</div>
                </button>
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold text-slate-700">Amount (INR) *</Label>
              <div className="relative mt-1">
                <span className="absolute left-3 top-2.5 text-sm font-bold text-slate-400">₹</span>
                <Input
                  type="number"
                  step="0.01"
                  required
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="450.00"
                  className="pl-7 font-mono font-bold text-base"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold text-slate-700">Payment Purpose / Description *</Label>
              <Input
                type="text"
                required
                value={form.purpose}
                onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                placeholder="e.g. Daily EV Battery & Fleet Rent"
                className="mt-1 text-xs"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold text-slate-700">Customer / Driver Name</Label>
                <Input
                  type="text"
                  value={form.customer_name}
                  onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                  placeholder="Ramesh Kumar"
                  className="mt-1 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold text-slate-700">Driver / Investor ID</Label>
                <Input
                  type="text"
                  value={form.driver_id}
                  onChange={(e) => setForm({ ...form, driver_id: e.target.value.toUpperCase() })}
                  placeholder="DRV-0001"
                  className="mt-1 text-xs font-mono uppercase"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold text-slate-700">Customer Phone (for WhatsApp/SMS)</Label>
              <Input
                type="text"
                value={form.customer_phone}
                onChange={(e) => setForm({ ...form, customer_phone: e.target.value })}
                placeholder="+91 98765 43210"
                className="mt-1 text-xs font-mono"
              />
            </div>

            <DialogFooter className="pt-2 flex flex-col-reverse sm:flex-row gap-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} className="w-full sm:w-auto">
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="w-full sm:w-auto bg-[#2563EB] text-white hover:bg-blue-700 font-bold">
                {submitting ? "Generating Link..." : "Generate Payment Link"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* MODAL 2: CONFIGURE REAL BANK UPI IDS (Responsive) */}
      <Dialog open={editAccountsOpen} onOpenChange={setEditAccountsOpen}>
        <DialogContent className="bg-white sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg font-bold">Configure Real Bank UPI IDs & Payees</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveAccounts} className="space-y-3.5 pt-2">
            <p className="text-xs text-slate-600">
              Enter your real registered bank UPI ID (e.g. your Kotak UPI ID or any live bank UPI address). 
              When a payer scans the QR code in Google Pay or PhonePe, NPCI verifies this UPI ID and allows real payments!
            </p>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 space-y-2">
              <div className="flex items-center gap-2 font-bold text-emerald-900 text-xs">
                <Users className="h-3.5 w-3.5 text-emerald-700" /> Account 1: Driver Operations UPI ID
              </div>
              <div>
                <Label className="text-[11px] font-semibold text-slate-700">Driver VPA (UPI ID) *</Label>
                <Input
                  type="text"
                  required
                  value={accountsForm.driver_vpa}
                  onChange={(e) => setAccountsForm({ ...accountsForm, driver_vpa: e.target.value.trim() })}
                  placeholder="e.g. yourcompany@kotak"
                  className="mt-1 text-xs font-mono bg-white"
                />
              </div>
              <div>
                <Label className="text-[11px] font-semibold text-slate-700">Payee Name</Label>
                <Input
                  type="text"
                  value={accountsForm.driver_account_name}
                  onChange={(e) => setAccountsForm({ ...accountsForm, driver_account_name: e.target.value })}
                  placeholder="Route39 Mobility"
                  className="mt-1 text-xs bg-white"
                />
              </div>
            </div>

            <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 space-y-2">
              <div className="flex items-center gap-2 font-bold text-indigo-900 text-xs">
                <Briefcase className="h-3.5 w-3.5 text-indigo-700" /> Account 2: Investor Capital UPI ID
              </div>
              <div>
                <Label className="text-[11px] font-semibold text-slate-700">Investor VPA (UPI ID) *</Label>
                <Input
                  type="text"
                  required
                  value={accountsForm.investor_vpa}
                  onChange={(e) => setAccountsForm({ ...accountsForm, investor_vpa: e.target.value.trim() })}
                  placeholder="e.g. yourinvestors@kotak"
                  className="mt-1 text-xs font-mono bg-white"
                />
              </div>
              <div>
                <Label className="text-[11px] font-semibold text-slate-700">Payee Name</Label>
                <Input
                  type="text"
                  value={accountsForm.investor_account_name}
                  onChange={(e) => setAccountsForm({ ...accountsForm, investor_account_name: e.target.value })}
                  placeholder="Route39 Capital"
                  className="mt-1 text-xs bg-white"
                />
              </div>
            </div>

            <DialogFooter className="pt-2 flex flex-col-reverse sm:flex-row gap-2">
              <Button type="button" variant="outline" onClick={() => setEditAccountsOpen(false)} className="w-full sm:w-auto">
                Cancel
              </Button>
              <Button type="submit" disabled={savingAccounts} className="w-full sm:w-auto bg-emerald-600 text-white hover:bg-emerald-700 font-bold">
                {savingAccounts ? "Saving..." : "Save UPI Configurations"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* MODAL 3: QR CODE & SHARE (Responsive) */}
      <Dialog open={!!qrModalOrder} onOpenChange={(open) => !open && setQrModalOrder(null)}>
        <DialogContent className="bg-[#0B0F19] text-white sm:max-w-sm max-h-[95vh] overflow-y-auto border border-white/10">
          <DialogHeader>
            <DialogTitle className="text-center text-sm sm:text-base font-bold text-white">
              Scan & Pay via UPI ({qrModalOrder?.account_type || "DRIVER"} A/C)
            </DialogTitle>
          </DialogHeader>
          {qrModalOrder && (
            <div className="flex flex-col items-center py-1 text-center">
              <div className="text-xs text-slate-400">{qrModalOrder.purpose}</div>
              <div className="mt-1 text-2xl sm:text-3xl font-extrabold text-[#B9F36B]">{inr(qrModalOrder.amount)}</div>
              
              <div className="mt-3 rounded-2xl bg-white p-3.5 shadow-xl">
                <QRCodeSVG
                  value={qrModalOrder.qr_payload || qrModalOrder.upi_intent_url}
                  size={180}
                  level="H"
                  includeMargin={false}
                />
              </div>

              <div className="mt-2.5 font-mono text-[11px] text-slate-300">
                UPI ID: <span className="font-bold text-white">{qrModalOrder.vpa}</span>
              </div>

              <div className="mt-1 text-[10px] text-emerald-400 font-semibold">
                ✓ Standard NPCI UPI Intent (GPay, PhonePe, Paytm, BHIM)
              </div>

              <div className="mt-3 flex w-full gap-2">
                <button
                  onClick={() => copyLink(qrModalOrder.order_id)}
                  className="flex-1 rounded-xl bg-white/10 py-2.5 text-xs font-bold text-white hover:bg-white/20 transition flex items-center justify-center gap-1.5"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy Link
                </button>
                <a
                  href={`/pay/${qrModalOrder.order_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 rounded-xl bg-[#B9F36B] py-2.5 text-xs font-bold text-[#0B0F19] hover:bg-[#a6de57] transition flex items-center justify-center gap-1.5"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open Checkout
                </a>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
