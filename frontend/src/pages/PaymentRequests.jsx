import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { PageHeader, StatusBadge, SimBadge, FilterSelect } from "../components/kit";
import { ListTable } from "../components/ListPage";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { useApi, errMsg } from "../lib/api";
import { inr, dt, CITIES, REQUEST_STATUSES, PROVIDERS, METHODS } from "../lib/format";
import { useMe } from "../context/MeContext";

export const reqColumns = [
  { key: "created_at", label: "Created", render: (r) => <span className="text-xs text-slate-500">{dt(r.created_at)}</span> },
  { key: "id", label: "Payment ID", mono: true, render: (r) => <div className="flex items-center gap-1.5">{r.id}<SimBadge show={r.is_simulated} /></div> },
  { key: "driver_name", label: "Driver", render: (r) => <div><div className="font-medium">{r.driver_name}</div><div className="text-[11px] text-slate-400">{r.vehicle_reg} · {r.city}</div></div> },
  { key: "provider", label: "Provider", render: (r) => <span className="text-xs">{r.provider} · {r.method}</span> },
  { key: "utr", label: "UTR / claim", mono: true, render: (r) => r.utr || (r.claimed_utr ? <span className="text-amber-700">{r.claimed_utr} (claimed)</span> : "—") },
  { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} testid={`req-status-${r.id}`} /> },
  { key: "reconciliation_status", label: "Recon", render: (r) => <StatusBadge status={r.reconciliation_status} /> },
  { key: "total_payable", label: "Payable", align: "right", render: (r) => inr(r.amount_requested ?? r.total_payable) },
];

export function CreateRequestDialog({ open, onOpenChange, driverId = "", onCreated }) {
  const api = useApi();
  const [form, setForm] = useState({ driver_id: driverId, provider: "MOCK", method: "UPI_QR" });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post("/admin/payment-requests", { ...form, driver_id: form.driver_id || driverId });
      toast.success(`Payment request ${r.data.id} created`);
      onCreated?.(r.data);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white" data-testid="create-request-dialog">
        <DialogHeader><DialogTitle>New payment request</DialogTitle></DialogHeader>
        <p className="text-xs text-slate-500">Amount is computed server-side from the driver's authorised rent + outstanding. In production EV Rent calls <code>POST /api/v1/payments/create</code>.</p>
        <div className="space-y-3">
          <div><Label>Driver ID</Label><Input value={form.driver_id || driverId} onChange={(e) => setForm({ ...form, driver_id: e.target.value.toUpperCase() })} placeholder="DRV-0001" data-testid="create-request-driver-input" /></div>
          <div className="flex gap-3">
            <div><Label>Provider</Label><FilterSelect value={form.provider} onChange={(v) => setForm({ ...form, provider: v })} options={["MOCK", "STATIC_QR"]} allLabel="Primary" testid="create-request-provider" /></div>
            <div><Label>Method</Label><FilterSelect value={form.method} onChange={(v) => setForm({ ...form, method: v === "ALL" ? "UPI_QR" : v })} options={METHODS} allLabel="UPI QR" testid="create-request-method" /></div>
          </div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={busy} className="bg-[#111827]" data-testid="create-request-submit-btn">Create request</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PaymentRequests() {
  const nav = useNavigate();
  const { isFinance } = useMe();
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHeader title="Payment requests" subtitle="One request per driver payment, created by EV Rent. Only verified bank/provider evidence can move a request to Success.">
        {isFinance && <Button onClick={() => setOpen(true)} className="bg-[#B9F36B] text-[#111827] hover:bg-[#a3e635]" data-testid="new-request-btn"><Plus className="mr-1 h-4 w-4" />New request</Button>}
      </PageHeader>
      <ListTable endpoint="/admin/payment-requests" testid="requests-table" columns={reqColumns} onRowClick={(r) => nav(`/requests/${r.id}`)}
        filters={[{ key: "status", label: "Statuses", options: REQUEST_STATUSES }, { key: "city", label: "Cities", options: CITIES },
          { key: "provider", label: "Providers", options: PROVIDERS }, { key: "method", label: "Methods", options: METHODS },
          { key: "date_from", type: "date" }, { key: "date_to", type: "date" }]} />
      <CreateRequestDialog open={open} onOpenChange={setOpen} onCreated={(r) => nav(`/requests/${r.id}`)} />
    </>
  );
}
