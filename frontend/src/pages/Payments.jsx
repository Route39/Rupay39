import { useNavigate } from "react-router-dom";
import { PageHeader, StatusBadge, SimBadge } from "../components/kit";
import { ListTable } from "../components/ListPage";
import { inr, dt, CITIES, TXN_STATUSES, PROVIDERS, RECON_STATUSES } from "../lib/format";

export const txnColumns = [
  { key: "created_at", label: "Time", render: (r) => <span className="text-xs text-slate-500">{dt(r.created_at)}</span> },
  { key: "id", label: "Transaction", mono: true, render: (r) => <div className="flex items-center gap-1.5">{r.id}<SimBadge show={r.is_simulated} /></div> },
  { key: "driver_name", label: "Driver", render: (r) => <div><div className="font-medium">{r.driver_name}</div><div className="text-[11px] text-slate-400">{r.vehicle_reg} · {r.city}</div></div> },
  { key: "kind", label: "Kind", render: (r) => <span className="text-xs">{r.kind}</span> },
  { key: "utr", label: "UTR", mono: true },
  { key: "provider", label: "Provider", render: (r) => <span className="text-xs">{r.provider} · {r.source}</span> },
  { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
  { key: "reconciliation_status", label: "Recon", render: (r) => <StatusBadge status={r.reconciliation_status} /> },
  { key: "myvolt_sync_status", label: "MyVolt", render: (r) => <StatusBadge status={r.myvolt_sync_status} /> },
  { key: "amount", label: "Amount", align: "right", render: (r) => inr(r.amount) },
];

export default function Payments() {
  const nav = useNavigate();
  return (
    <>
      <PageHeader title="Payments" subtitle="Every transaction recorded by the verification engine — provider callbacks, bank-statement matches and manual resolutions. Records are never deleted or overwritten." />
      <ListTable endpoint="/admin/transactions" testid="transactions-table" columns={txnColumns} onRowClick={(r) => nav(`/requests/${r.payment_id}`)}
        filters={[{ key: "status", label: "Statuses", options: TXN_STATUSES }, { key: "city", label: "Cities", options: CITIES },
          { key: "provider", label: "Providers", options: PROVIDERS }, { key: "kind", label: "Kinds", options: ["PAYMENT", "REVERSAL", "REFUND"] },
          { key: "reconciliation_status", label: "Recon", options: RECON_STATUSES }, { key: "date_from", type: "date" }, { key: "date_to", type: "date" }]} />
    </>
  );
}
