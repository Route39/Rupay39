import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { 
  ShieldCheck, 
  Clock, 
  Smartphone, 
  QrCode, 
  Copy, 
  CheckCircle2, 
  ExternalLink, 
  ArrowRight, 
  AlertCircle, 
  Zap, 
  FileText, 
  RefreshCw,
  Check,
  Download,
  Share2,
  Lock,
  Landmark,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { toast } from "sonner";
import { inr, dt } from "@/lib/format";

// Always resolve backend API base reliably
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || (typeof window !== "undefined" && window.location.hostname === "localhost" ? "http://localhost:8010" : "");
const API_BASE = `${BACKEND_URL}/api`;

// Pure CSS/SVG Confetti Particle Component
function ConfettiExplosion() {
  const colors = ["#B9F36B", "#38BDF8", "#F43F5E", "#F59E0B", "#A855F7", "#10B981"];
  const particles = Array.from({ length: 40 }).map((_, i) => ({
    id: i,
    color: colors[i % colors.length],
    x: (Math.random() - 0.5) * 320,
    y: -(Math.random() * 220 + 80),
    rotation: Math.random() * 720 - 360,
    scale: Math.random() * 0.7 + 0.4,
    shape: i % 3 === 0 ? "circle" : "square",
  }));

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden flex items-center justify-center">
      {particles.map((p) => (
        <span
          key={p.id}
          className="absolute animate-bounce"
          style={{
            backgroundColor: p.color,
            width: p.shape === "circle" ? "10px" : "8px",
            height: "10px",
            borderRadius: p.shape === "circle" ? "9999px" : "2px",
            transform: `translate(${p.x}px, ${p.y}px) rotate(${p.rotation}deg) scale(${p.scale})`,
            transition: "all 1.2s cubic-bezier(0.25, 1, 0.5, 1)",
            opacity: 0.9,
          }}
        />
      ))}
    </div>
  );
}

export default function HostedCheckout() {
  const { orderId } = useParams();
  const navigate = useNavigate();

  const isMobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState(isMobile ? "apps" : "qr");
  const [timeLeft, setTimeLeft] = useState(null);
  const [manualUtr, setManualUtr] = useState("");
  const [submittingUtr, setSubmittingUtr] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [copiedField, setCopiedField] = useState(null);
  const [celebrate, setCelebrate] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  const pollIntervalRef = useRef(null);

  const handleLaunchApp = (appName, uri) => {
    if (isMobile) {
      // Trigger native mobile UPI deep-link intent
      try {
        window.location.href = uri;
      } catch {
        setActiveTab("qr");
        toast.error(`Unable to launch ${appName}. Please scan the QR code instead.`);
      }
    } else {
      // Desktop / Mac / PC browser: guide user to scan QR code
      setActiveTab("qr");
      toast.info(`On computer/laptop: Open ${appName} on your phone and scan the QR code!`, {
        duration: 4500,
        icon: "📱",
      });
    }
  };

  const fetchOrderStatus = useCallback(async (isInitial = false) => {
    try {
      const res = await fetch(`${API_BASE}/checkout/orders/${orderId}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error("Payment order not found or invalid link.");
        throw new Error("Unable to load payment details from server.");
      }
      const data = await res.json();
      setOrder(data);
      if (isInitial && data.time_remaining_seconds) {
        setTimeLeft(data.time_remaining_seconds);
      }
      if (data.status === "SUCCESS") {
        setCelebrate(true);
        clearInterval(pollIntervalRef.current);
      }
      return data;
    } catch (err) {
      setError(err.message);
      clearInterval(pollIntervalRef.current);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    fetchOrderStatus(true);
    pollIntervalRef.current = setInterval(() => {
      fetchOrderStatus(false);
    }, 1500);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [fetchOrderStatus]);

  // Live countdown timer
  useEffect(() => {
    if (timeLeft === null || timeLeft <= 0 || order?.status === "SUCCESS") return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft, order?.status]);

  const copyToClipboard = (text, fieldName) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    toast.success(`${fieldName} copied to clipboard!`);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleSimulatePayment = async () => {
    setSimulating(true);
    try {
      const res = await fetch(`${API_BASE}/checkout/orders/${orderId}/simulate-pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Payment simulation failed");
      toast.success("Payment verified instantly!");
      setCelebrate(true);
      await fetchOrderStatus(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSimulating(false);
    }
  };

  const handleSubmitUtr = async (e) => {
    e.preventDefault();
    if (!manualUtr || manualUtr.trim().length < 10) {
      toast.error("Please enter a valid 12-digit UPI reference (UTR)");
      return;
    }
    setSubmittingUtr(true);
    try {
      const res = await fetch(`${API_BASE}/checkout/orders/${orderId}/utr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utr: manualUtr.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to submit UTR");
      toast.success("UTR submitted for reconciliation. Listening for bank confirmation...");
      setManualUtr("");
      await fetchOrderStatus(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmittingUtr(false);
    }
  };

  const formatCountdown = (seconds) => {
    if (!seconds || seconds <= 0) return "00:00";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#070A11] text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="relative flex h-12 w-12 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#B9F36B] opacity-40"></span>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#B9F36B] font-black text-[#0B0F19] shadow-lg">
              ₹
            </div>
          </div>
          <p className="text-xs font-semibold tracking-wider uppercase text-slate-400">Loading Secure Checkout...</p>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#070A11] p-4 text-white">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0F172A] p-8 text-center shadow-2xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-400">
            <AlertCircle className="h-8 w-8" />
          </div>
          <h2 className="mt-4 text-xl font-bold">Checkout Unavailable</h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">{error || "Payment order not found or invalid link."}</p>
          <div className="mt-6 flex flex-col gap-2">
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/10 py-2.5 text-xs font-semibold text-white transition hover:bg-white/20"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Try Again
            </button>
            <button
              onClick={() => navigate("/")}
              className="inline-flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold text-slate-400 hover:text-white"
            >
              Return to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  // SUCCESS STATE (Celebratory Transition)
  if (order.status === "SUCCESS") {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-[#070A11] p-4">
        {celebrate && <ConfettiExplosion />}

        <div className="w-full max-w-md overflow-hidden rounded-3xl border border-[#B9F36B]/40 bg-[#0F172A] shadow-2xl shadow-[#B9F36B]/15">
          {/* Header Card */}
          <div className="relative overflow-hidden bg-gradient-to-b from-[#B9F36B]/25 via-[#B9F36B]/10 to-transparent p-8 text-center">
            {/* Animated Checkmark Circle */}
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-[#B9F36B] text-[#070A11] shadow-xl shadow-[#B9F36B]/50">
              <Check className="h-12 w-12 stroke-[3.5]" />
            </div>

            <div className="inline-flex items-center gap-1.5 rounded-full border border-[#B9F36B]/40 bg-[#B9F36B]/15 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-[#B9F36B]">
              <ShieldCheck className="h-3.5 w-3.5" /> Bank Confirmed
            </div>

            <h1 className="mt-3 text-2xl font-black text-white">Payment Received!</h1>
            <p className="mt-1 text-xs text-slate-300">Verified & credited via NPCI UPI</p>

            <div className="mt-4 text-4xl font-black text-[#B9F36B]">
              {inr(order.amount)}
            </div>
          </div>

          {/* Receipt Info Body */}
          <div className="border-t border-white/10 bg-black/20 p-6 space-y-3 text-xs">
            <div className="flex justify-between border-b border-white/5 pb-2.5">
              <span className="text-slate-400">Official Receipt #</span>
              <span className="font-mono font-bold text-white">{order.receipt_no || "Issued"}</span>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-2.5">
              <span className="text-slate-400">Bank UTR / Ref</span>
              <span className="font-mono font-bold text-[#B9F36B]">{order.utr || "Verified"}</span>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-2.5">
              <span className="text-slate-400">Customer / Driver</span>
              <span className="font-medium text-white">{order.customer_name}</span>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-2.5">
              <span className="text-slate-400">Purpose</span>
              <span className="font-medium text-white max-w-[200px] truncate text-right">{order.purpose}</span>
            </div>
            <div className="flex justify-between pb-1">
              <span className="text-slate-400">Date & Time</span>
              <span className="font-mono text-slate-300">{order.confirmed_at ? dt(order.confirmed_at) : "Just now"}</span>
            </div>

            {/* Live Bank Settlement Logs Accordion */}
            <div className="pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setShowLogs(!showLogs)}
                className="flex w-full items-center justify-between text-[11px] font-semibold text-slate-400 hover:text-white py-1 cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <Landmark className="h-3.5 w-3.5 text-[#B9F36B]" />
                  <span>Bank Settlement & Audit Trail</span>
                </span>
                {showLogs ? <ChevronUp className="h-3.5 w-3.5 text-[#B9F36B]" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
              </button>

              {showLogs && (
                <div className="mt-2.5 space-y-2 rounded-xl bg-black/40 p-3 text-left font-mono text-[10px] text-slate-300 border border-white/10">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Receiving Bank:</span>
                    <span className="text-white font-bold">Kotak Mahindra Bank</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Account:</span>
                    <span className="text-white">Route39 Current A/C (•••• 3901)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Settlement SLA:</span>
                    <span className="text-[#B9F36B] font-bold">Instant T+0 Direct Credit</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Bank UTR:</span>
                    <span className="text-[#B9F36B]">{order.utr || "Verified"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Ledger Lock:</span>
                    <span className="text-emerald-400">Engaged (Zero Double-Spend)</span>
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="pt-4 flex flex-col gap-2.5">
              {order.receipt_no && (
                <Link
                  to={`/receipts/${order.receipt_no}`}
                  target="_blank"
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#B9F36B] py-3.5 text-center text-xs font-black uppercase tracking-wider text-[#070A11] shadow-lg shadow-[#B9F36B]/20 transition hover:bg-[#a3e635]"
                >
                  <FileText className="h-4 w-4" /> Download / View Receipt
                </Link>
              )}

              {order.redirect_url ? (
                <a
                  href={order.redirect_url}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 py-3 text-center text-xs font-bold text-white hover:bg-white/10 transition"
                >
                  Return to App <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : (
                <button
                  onClick={() => navigate("/")}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-3 text-center text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/10 transition"
                >
                  Close & Return
                </button>
              )}
            </div>
          </div>

          <div className="border-t border-white/5 bg-[#070A11] py-2.5 text-center text-[10px] text-slate-500">
            RUPAY39 Payment Gateway · Powered by Route39 Mobility
          </div>
        </div>
      </div>
    );
  }

  // EXPIRED STATE
  if (order.status === "EXPIRED" || (timeLeft !== null && timeLeft <= 0)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#070A11] p-4 text-white">
        <div className="w-full max-w-md rounded-3xl border border-rose-500/25 bg-[#0F172A] p-8 text-center shadow-2xl">
          <Clock className="mx-auto h-12 w-12 text-rose-400" />
          <h2 className="mt-4 text-xl font-bold">Payment Link Expired</h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            For security, dynamic UPI links expire after a set timeout. Please request a fresh payment link from Route39.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-white transition hover:bg-white/20"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Check Again
          </button>
        </div>
      </div>
    );
  }

  // ACTIVE CHECKOUT INTERFACE
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#070A11] p-3 sm:p-6 text-slate-100">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[#0F172A] shadow-2xl">
        
        {/* Brand Top Header */}
        <div className="flex items-center justify-between border-b border-white/10 bg-[#070A11] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#B9F36B] font-black text-[#070A11]">
              ₹
            </div>
            <div>
              <div className="text-sm font-extrabold tracking-tight text-white leading-tight">
                RUPAY<span className="text-[#B9F36B]">39</span>
              </div>
              <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                Route39 Checkout
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-400">
            <Lock className="h-3 w-3" /> NPCI UPI 256-Bit
          </div>
        </div>

        {/* Order Details Banner */}
        <div className="bg-gradient-to-b from-[#1E293B] to-[#0F172A] px-6 py-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-medium text-slate-400">Merchant</p>
              <h3 className="text-sm font-bold text-white">{order.merchant_name}</h3>
              <p className="mt-0.5 text-xs text-slate-300 max-w-[200px] truncate">{order.purpose}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-medium text-slate-400">Total Payable</p>
              <div className="text-2xl font-black text-[#B9F36B]">{inr(order.amount)}</div>
            </div>
          </div>

          {/* Expiry Countdown Bar */}
          <div className="mt-4 flex items-center justify-between rounded-xl border border-white/5 bg-black/40 px-3.5 py-2 text-xs">
            <span className="flex items-center gap-1.5 text-slate-300">
              <Clock className="h-3.5 w-3.5 text-amber-400 animate-pulse" />
              Link expires in:
            </span>
            <span className={`font-mono font-bold ${timeLeft < 180 ? "text-rose-400" : "text-amber-300"}`}>
              {formatCountdown(timeLeft)}
            </span>
          </div>
        </div>

        {/* Tab Controls: Mobile UPI Apps vs Scan QR */}
        <div className="grid grid-cols-2 border-b border-white/10 bg-[#070A11] text-xs font-bold">
          <button
            onClick={() => setActiveTab("apps")}
            className={`flex items-center justify-center gap-2 py-3 transition ${
              activeTab === "apps"
                ? "border-b-2 border-[#B9F36B] bg-[#0F172A] text-[#B9F36B]"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Smartphone className="h-4 w-4" /> UPI Apps Intent
          </button>
          <button
            onClick={() => setActiveTab("qr")}
            className={`flex items-center justify-center gap-2 py-3 transition ${
              activeTab === "qr"
                ? "border-b-2 border-[#B9F36B] bg-[#0F172A] text-[#B9F36B]"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <QrCode className="h-4 w-4" /> Scan Dynamic QR
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === "apps" && (
            <div className="space-y-3">
              <p className="text-xs text-slate-300">
                {isMobile ? "Tap your installed UPI app to pay directly:" : "Tap an app to view its mobile payment instructions, or switch to Dynamic QR:"}
              </p>

              {/* Google Pay */}
              <button
                type="button"
                onClick={() => handleLaunchApp("Google Pay", order.upi_uris?.gpay || order.upi_intent_url)}
                className="w-full flex items-center justify-between rounded-2xl border border-white/10 bg-[#1E293B]/70 p-3.5 transition hover:border-[#B9F36B]/50 hover:bg-[#1E293B] active:scale-[0.98] text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-900 shadow font-black">
                    <span className="text-base font-black">G</span>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">Google Pay</div>
                    <div className="text-[11px] text-slate-400">Pay directly via GPay UPI</div>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-[#B9F36B]" />
              </button>

              {/* PhonePe */}
              <button
                type="button"
                onClick={() => handleLaunchApp("PhonePe", order.upi_uris?.phonepe || order.upi_intent_url)}
                className="w-full flex items-center justify-between rounded-2xl border border-white/10 bg-[#1E293B]/70 p-3.5 transition hover:border-[#B9F36B]/50 hover:bg-[#1E293B] active:scale-[0.98] text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#5f259f] text-white shadow font-black">
                    <span className="text-base font-black">पे</span>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">PhonePe</div>
                    <div className="text-[11px] text-slate-400">Instant PhonePe checkout</div>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-[#B9F36B]" />
              </button>

              {/* Paytm */}
              <button
                type="button"
                onClick={() => handleLaunchApp("Paytm", order.upi_uris?.paytm || order.upi_intent_url)}
                className="w-full flex items-center justify-between rounded-2xl border border-white/10 bg-[#1E293B]/70 p-3.5 transition hover:border-[#B9F36B]/50 hover:bg-[#1E293B] active:scale-[0.98] text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#00b9f1] text-white shadow font-black">
                    <span className="text-base font-black">P</span>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">Paytm UPI</div>
                    <div className="text-[11px] text-slate-400">Fast 1-click payment</div>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-[#B9F36B]" />
              </button>

              {/* Generic UPI Apps */}
              <button
                type="button"
                onClick={() => handleLaunchApp("UPI App", order.upi_intent_url)}
                className="w-full flex items-center justify-between rounded-2xl border border-[#B9F36B]/30 bg-[#B9F36B]/10 p-3.5 transition hover:bg-[#B9F36B]/20 active:scale-[0.98] text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#B9F36B] text-[#070A11] shadow">
                    <Zap className="h-5 w-5 fill-current" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-[#B9F36B]">Other UPI Apps</div>
                    <div className="text-[11px] text-slate-300">BHIM, CRED, Navi, Bank Apps</div>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-[#B9F36B]" />
              </button>
            </div>
          )}

          {activeTab === "qr" && (
            <div className="flex flex-col items-center">
              {/* Dynamic QR Box */}
              <div className="relative rounded-2xl bg-white p-4 shadow-2xl">
                <QRCodeSVG
                  value={order.qr_payload || order.upi_intent_url}
                  size={200}
                  level="H"
                  includeMargin={false}
                />
              </div>

              <p className="mt-4 text-center text-xs text-slate-300">
                Scan with any UPI App: <span className="font-semibold text-white">GPay, PhonePe, Paytm, BHIM, CRED</span>
              </p>

              {/* UPI ID Copy Bar */}
              <div className="mt-4 flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 p-2.5 text-xs">
                <div className="truncate">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Merchant UPI ID</div>
                  <div className="font-mono font-bold text-white">{order.vpa}</div>
                </div>
                <button
                  onClick={() => copyToClipboard(order.vpa, "UPI ID")}
                  className="flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-white/20"
                >
                  <Copy className="h-3 w-3" />
                  {copiedField === "UPI ID" ? "Copied" : "Copy"}
                </button>
              </div>

              <div className="mt-2 flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 p-2.5 text-xs">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Order Reference</div>
                  <div className="font-mono font-medium text-white">{order.internal_ref}</div>
                </div>
                <button
                  onClick={() => copyToClipboard(order.internal_ref, "Reference Code")}
                  className="flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-white/20"
                >
                  <Copy className="h-3 w-3" />
                  {copiedField === "Reference Code" ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          )}

          {/* Manual UTR Claim Form */}
          <div className="mt-5 border-t border-white/10 pt-4">
            <details className="group">
              <summary className="flex cursor-pointer items-center justify-between text-[11px] font-semibold text-slate-400 hover:text-white">
                <span>Paid via Netbanking? Enter 12-digit UTR</span>
                <span className="text-slate-500 transition-transform group-open:rotate-180">▼</span>
              </summary>
              <form onSubmit={handleSubmitUtr} className="mt-3 space-y-2">
                <input
                  type="text"
                  placeholder="Enter 12-digit UPI UTR (e.g. 412389102911)"
                  value={manualUtr}
                  onChange={(e) => setManualUtr(e.target.value)}
                  maxLength={22}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 font-mono text-xs text-white placeholder-slate-500 outline-none focus:border-[#B9F36B]"
                />
                <button
                  type="submit"
                  disabled={submittingUtr}
                  className="w-full rounded-xl bg-white/10 py-2 text-xs font-semibold text-white transition hover:bg-white/20 disabled:opacity-50"
                >
                  {submittingUtr ? "Submitting..." : "Submit UTR for Verification"}
                </button>
              </form>
            </details>
          </div>

          {/* SIMULATOR TEST BAR */}
          {order.is_simulated && (
            <div className="mt-5 rounded-2xl border border-emerald-500/30 bg-emerald-950/40 p-4 text-emerald-300">
              <div className="flex items-center gap-2 text-xs font-bold text-[#B9F36B]">
                <Zap className="h-4 w-4" /> Instant Test Simulator (Sandbox Mode)
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
                Click below to simulate immediate bank verification and see the instant confirmation in action.
              </p>
              <button
                onClick={handleSimulatePayment}
                disabled={simulating}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#B9F36B] py-2.5 text-xs font-black uppercase tracking-wider text-[#070A11] shadow transition hover:bg-[#a3e635] disabled:opacity-50"
              >
                {simulating ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Verifying Bank Response...
                  </>
                ) : (
                  <>
                    <Zap className="h-3.5 w-3.5" /> Simulate Instant Pay ({inr(order.amount)})
                  </>
                )}
              </button>
            </div>
          )}

          {/* Live Bank Settlement & Security Details */}
          <div className="mt-4 border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={() => setShowLogs(!showLogs)}
              className="flex w-full items-center justify-between text-[11px] font-semibold text-slate-400 hover:text-white py-1 cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <Landmark className="h-3.5 w-3.5 text-[#B9F36B]" />
                <span>Direct Bank Settlement & Security Info</span>
              </span>
              {showLogs ? <ChevronUp className="h-3.5 w-3.5 text-[#B9F36B]" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
            </button>

            {showLogs && (
              <div className="mt-2.5 space-y-2 rounded-xl bg-black/40 p-3 text-left font-mono text-[10px] text-slate-300 border border-white/5">
                <div className="flex justify-between">
                  <span className="text-slate-400">Bank Gateway:</span>
                  <span className="text-white font-bold">Kotak Mahindra Bank</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Account Credit:</span>
                  <span className="text-white">Route39 Mobility Current A/C</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Settlement Time:</span>
                  <span className="text-[#B9F36B] font-bold">Immediate T+0 (0-Second Delay)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Merchant VPA:</span>
                  <span className="text-white">{order.vpa}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">NPCI Ref:</span>
                  <span className="text-slate-300">{order.internal_ref}</span>
                </div>
                <div className="border-t border-white/5 pt-1.5 text-[9px] text-slate-400 leading-tight">
                  ✓ Funds credit directly into the company bank account the second your UPI PIN is approved.
                </div>
              </div>
            )}
          </div>

          {/* Auto-detect Notification */}
          <div className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
            </span>
            Waiting for bank confirmation...
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-white/5 bg-[#070A11] py-3 text-center text-[10px] text-slate-400">
          Powered by <span className="font-bold text-slate-300">RUPAY39</span> · Route39 Mobility
        </div>
      </div>
    </div>
  );
}
