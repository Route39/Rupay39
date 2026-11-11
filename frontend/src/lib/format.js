const inrFmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });
export const inr = (n) => inrFmt.format(Number(n || 0));
export const inrShort = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)}L`;
  if (Math.abs(v) >= 1e3) return `₹${(v / 1e3).toFixed(1)}K`;
  return `₹${v.toFixed(0)}`;
};
export const dt = (iso) =>
  iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
export const istDate = (offsetDays = 0) => new Date(Date.now() + 5.5 * 3600e3 - offsetDays * 86400e3).toISOString().slice(0, 10);
export const label = (s) => (s || "").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
export const CITIES = ["Chennai", "Coimbatore", "Madurai", "Bengaluru", "Mysuru"];
export const REQUEST_STATUSES = ["INITIATED", "PENDING", "SUCCESS", "FAILED", "EXPIRED", "UNMATCHED", "REFUNDED", "REVERSED"];
export const TXN_STATUSES = ["SUCCESS", "FAILED", "AMOUNT_MISMATCH", "DUPLICATE", "REVERSED", "REFUNDED"];
export const RECON_STATUSES = ["MATCHED", "UNMATCHED", "AMOUNT_MISMATCH", "DUPLICATE", "MISSING_IN_BANK", "MISSING_IN_SYSTEM", "UNDER_REVIEW"];
export const METHODS = ["UPI_QR", "UPI_INTENT"];
export const PROVIDERS = ["MOCK", "STATIC_QR", "KOTAK"];
