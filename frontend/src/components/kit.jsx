import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Input } from "./ui/input";
import { label } from "../lib/format";

const TONE = {
  ok: "bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]",
  wait: "bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]",
  bad: "bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]",
  info: "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]",
  muted: "bg-slate-100 text-slate-600 border-slate-200",
};
const MAP = {
  ok: ["SUCCESS", "MATCHED", "SYNCED", "RESOLVED", "ACTIVE", "RECONCILED", "LIVE_MANUAL"],
  wait: ["INITIATED", "PENDING", "SYNC_PENDING", "RETRY_PENDING", "UNDER_REVIEW", "OPEN", "ESCALATED", "PROCESSING", "UNRECONCILED", "SANDBOX", "AWAITING_DOCUMENTATION"],
  bad: ["FAILED", "EXPIRED", "AMOUNT_MISMATCH", "DUPLICATE", "SYNC_FAILED", "REVERSED", "REFUNDED", "DISCREPANCY", "MISSING_IN_BANK", "INACTIVE", "REJECTED_SIGNATURE"],
  info: ["UNMATCHED", "MISSING_IN_SYSTEM", "SETTLEMENT", "SIMULATED"],
};
const toneOf = (s) => Object.keys(MAP).find((k) => MAP[k].includes(s)) || "muted";

export const StatusBadge = ({ status, testid }) =>
  status ? (
    <span data-testid={testid} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${TONE[toneOf(status)]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label(status)}
    </span>
  ) : <span className="text-slate-400">—</span>;

export const SimBadge = ({ show }) =>
  show ? <span className="rounded border border-dashed border-[#1D4ED8]/40 bg-[#EFF6FF] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#1D4ED8]">Simulated</span> : null;

export const PageHeader = ({ title, subtitle, children }) => (
  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between fade-up">
    <div>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" data-testid="page-title">{title}</h1>
      {subtitle && <p className="mt-1 max-w-2xl text-sm text-slate-500">{subtitle}</p>}
    </div>
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  </div>
);

export const Card = ({ title, action, children, className = "", testid }) => (
  <section data-testid={testid} className={`rounded-xl border border-[#E2E8F0] bg-white ${className}`}>
    {title && (
      <div className="flex items-center justify-between border-b border-[#F1F5F9] px-5 py-3.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
    )}
    <div className="p-5">{children}</div>
  </section>
);

export const FilterSelect = ({ value, onChange, options, placeholder, testid, allLabel = "All", className = "w-40" }) => (
  <Select value={value || "ALL"} onValueChange={onChange}>
    <SelectTrigger className={`h-9 bg-white text-sm ${className}`} data-testid={testid}><SelectValue placeholder={placeholder} /></SelectTrigger>
    <SelectContent className="bg-white">
      <SelectItem value="ALL">{allLabel}{placeholder ? ` ${placeholder.toLowerCase()}` : ""}</SelectItem>
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        return <SelectItem key={v} value={v}>{typeof o === "string" ? label(o) : o.label}</SelectItem>;
      })}
    </SelectContent>
  </Select>
);

export const DateInput = ({ value, onChange, testid }) => (
  <Input type="date" value={value || ""} onChange={(e) => onChange(e.target.value)} className="h-9 w-[150px] bg-white text-sm" data-testid={testid} />
);

export const Field = ({ k, v, mono }) => (
  <div>
    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{k}</div>
    <div className={`mt-1 text-sm text-[#111827] ${mono ? "font-mono" : ""} break-all`}>{v ?? "—"}</div>
  </div>
);

export const Empty = ({ text = "No records found" }) => <div className="py-12 text-center text-sm text-slate-400">{text}</div>;
