import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, FlaskConical, ReceiptText } from "lucide-react";
import { Card, Field, PageHeader, StatusBadge, SimBadge } from "../components/kit";
import { DataTable } from "../components/DataTable";
import { Button } from "../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { useApi, useFetch, errMsg } from "../lib/api";
import { inr, dt, label } from "../lib/format";
import { useMe } from "../context/MeContext";
import { txnColumns } from "./Payments";

const SIMS = ["success", "failed", "wrong_amount", "duplicate_callback", "reversal", "refund"];

function Simulator({ id, onDone }) {
  const api = useApi();
  const [busy, setBusy] = useState(null);
  const run = async (outcome) => {
    setBusy(outcome);
    try {
      const r = await api.post(`/admin/payment-requests/${id}/simulate`, { outcome });
      toast.success(`Callback → HTTP ${r.data.http_status}: ${r.data.result.outcome || r.data.result.status}`);
      onDone();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card title={<span className="flex items-center gap-2"><FlaskConical className="h-4 w-4" />Mock provider simulator</span>} testid="simulator-card">
      <p className="mb-3 text-xs text-slate-500">Sends an HMAC-signed SIMULATED callback through the same verification engine a real provider uses. No real money moves.</p>
      <div className="flex flex-wrap gap-2">
        {SIMS.map((s) => <Button key={s} size="sm" variant="outline" disabled={!!busy} onClick={() => run(s)} data-testid={`simulate-${s}-btn`}>{label(s)}</Button>)}
      </div>
    </Card>
  );
}

const logCols = (extra = []) => [
  { key: "created_at", label: "Time", render: (r) => <span className="text-xs">{dt(r.created_at || r.received_at)}</span> },
  ...extra,
];

export default function PaymentDetail() {
  const { id } = useParams();
  const { isFinance } = useMe();
  const { data, reload, error } = useFetch(`/admin/payment-requests/${id}`);
  if (error) return <p className="text-sm text-red-600" data-testid="detail-error">{error}</p>;
  if (!data) return null;
  const r = data.request;
  const ins = r.instructions || {};
  return (
    <>
      <Link to="/requests" className="no-print inline-flex items-center gap-1 text-xs text-slate-500 hover:text-[#111827]" data-testid="back-to-requests"><ArrowLeft className="h-3.5 w-3.5" />Payment requests</Link>
      <PageHeader title={<span className="flex flex-wrap items-center gap-3 font-mono text-xl sm:text-2xl">{r.id}<StatusBadge status={r.status} testid="detail-status" /><StatusBadge status={r.reconciliation_status} testid="detail-recon-status" /><SimBadge show={r.is_simulated} /></span>}
        subtitle={`${r.driver_name} · ${r.vehicle_reg} · ${r.city}`}>
        {data.receipt && <Link to={`/receipts/${data.receipt.receipt_no}`}><Button variant="outline" size="sm" data-testid="view-receipt-btn"><ReceiptText className="mr-1.5 h-4 w-4" />Receipt</Button></Link>}
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Amounts" testid="detail-amounts">
          <div className="grid grid-cols-2 gap-4">
            <Field k="Rental due" v={inr(r.rental_amount)} mono /><Field k="Outstanding" v={inr(r.outstanding_amount)} mono />
            <Field k="Total payable" v={inr(r.total_payable)} mono /><Field k="Requested" v={<span className="font-bold">{inr(r.amount_requested)}</span>} mono />
          </div>
        </Card>
        <Card title="References" testid="detail-references">
          <div className="grid grid-cols-2 gap-4">
            <Field k="Internal ref" v={r.internal_ref} mono /><Field k="Bank UTR" v={r.utr} mono />
            <Field k="Claimed UTR" v={r.claimed_utr} mono /><Field k="Provider txn" v={r.provider_txn_id} mono />
            <Field k="Provider" v={`${r.provider} · ${r.method}`} /><Field k="MyVolt sync" v={<StatusBadge status={r.sync_status} />} />
          </div>
        </Card>
        <Card title="Timeline" testid="detail-timeline">
          <div className="grid grid-cols-2 gap-4">
            <Field k="Created" v={dt(r.created_at)} /><Field k="Expires" v={dt(r.expires_at)} />
            <Field k="Confirmed" v={dt(r.confirmed_at)} /><Field k="Late confirmation" v={r.late_confirmation ? "Yes" : "No"} />
            <Field k="Client" v={r.client_id} mono /><Field k="Receipt" v={r.receipt_no} mono />
          </div>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Payment instructions returned to EV Rent" className="lg:col-span-2" testid="detail-instructions">
          <pre className="overflow-x-auto rounded-lg bg-[#F8FAFC] p-3 font-mono text-[11px] leading-relaxed text-slate-700">{JSON.stringify(ins, null, 2)}</pre>
        </Card>
        {isFinance && r.provider === "MOCK" && <Simulator id={r.id} onDone={reload} />}
      </div>
      <Tabs defaultValue="txns" className="space-y-3">
        <TabsList className="bg-white">
          <TabsTrigger value="txns" data-testid="tab-transactions">Transactions ({data.transactions.length})</TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit">Audit trail ({data.audit.length})</TabsTrigger>
          <TabsTrigger value="sync" data-testid="tab-sync">Sync ({data.myvolt_sync.length + data.evrent_sync.length})</TabsTrigger>
          <TabsTrigger value="hooks" data-testid="tab-webhooks">Callbacks ({data.webhooks.length})</TabsTrigger>
          <TabsTrigger value="exc" data-testid="tab-exceptions">Exceptions ({data.exceptions.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="txns"><DataTable columns={txnColumns} rows={data.transactions} testid="detail-txn-table" /></TabsContent>
        <TabsContent value="audit"><DataTable testid="detail-audit-table" rows={data.audit} columns={logCols([
          { key: "action", label: "Action", render: (x) => <span className="font-mono text-xs">{x.action}</span> },
          { key: "actor_email", label: "By" }, { key: "before_status", label: "From", render: (x) => <StatusBadge status={x.before_status} /> },
          { key: "after_status", label: "To", render: (x) => <StatusBadge status={x.after_status} /> }, { key: "reason", label: "Reason" }, { key: "evidence_ref", label: "Evidence", mono: true }])} /></TabsContent>
        <TabsContent value="sync"><DataTable testid="detail-sync-table" rows={[...data.myvolt_sync, ...data.evrent_sync]} columns={logCols([
          { key: "target", label: "Target" }, { key: "event_type", label: "Event", mono: true }, { key: "status", label: "Status", render: (x) => <StatusBadge status={x.status} /> },
          { key: "attempts", label: "Attempts" }, { key: "last_error", label: "Last error", render: (x) => <span className="text-xs text-red-600">{x.last_error || "—"}</span> }])} /></TabsContent>
        <TabsContent value="hooks"><DataTable testid="detail-webhook-table" rows={data.webhooks} rowKey="event_key" columns={logCols([
          { key: "event_key", label: "Event", mono: true }, { key: "signature_valid", label: "Signature", render: (x) => (x.signature_valid ? "Valid" : "Invalid") },
          { key: "result", label: "Result", render: (x) => <StatusBadge status={x.result} /> }, { key: "duplicate_count", label: "Duplicates ignored" }])} /></TabsContent>
        <TabsContent value="exc"><DataTable testid="detail-exc-table" rows={data.exceptions} columns={logCols([
          { key: "type", label: "Type", render: (x) => label(x.type) }, { key: "status", label: "Status", render: (x) => <StatusBadge status={x.status} /> }, { key: "details", label: "Details" }])} /></TabsContent>
      </Tabs>
    </>
  );
}
