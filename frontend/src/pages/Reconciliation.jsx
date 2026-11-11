import { useState } from "react";
import { toast } from "sonner";
import { Play } from "lucide-react";
import { Card, PageHeader, StatusBadge } from "../components/kit";
import { ListTable } from "../components/ListPage";
import { DataTable } from "../components/DataTable";
import { Button } from "../components/ui/button";
import { useApi, useFetch, errMsg } from "../lib/api";
import { inr, dt, RECON_STATUSES } from "../lib/format";

const SumTable = ({ rows, testid }) => (
  <DataTable testid={testid} rowKey="status" rows={rows} columns={[
    { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status || "UNMATCHED"} /> },
    { key: "count", label: "Count", align: "right" }, { key: "amount", label: "Amount", align: "right", render: (r) => inr(r.amount) }]} />
);

export default function Reconciliation() {
  const api = useApi();
  const { data, reload } = useFetch("/reconciliation/summary");
  const [run, setRun] = useState(null);
  const [rk, setRk] = useState(0);
  const runNow = async () => {
    try {
      const r = await api.post("/reconciliation/run");
      toast.success(`Run ${r.data.run_id} complete`, { description: Object.entries(r.data.counts).map(([k, v]) => `${k.replace(/_/g, " ").toLowerCase()}: ${v}`).join(" · ") || "Nothing new to reconcile" });
      reload();
      setRk((x) => x + 1);
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <>
      <PageHeader title="Reconciliation" subtitle="Bank statement lines vs RUPAY39 verified transactions. UTR is the only automatic match key.">
        <Button onClick={runNow} className="bg-[#111827]" data-testid="run-recon-btn"><Play className="mr-1.5 h-4 w-4" />Run reconciliation</Button>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Bank side (statement lines)"><SumTable rows={data?.bank} testid="recon-bank-summary" /></Card>
        <Card title="System side (verified payments)"><SumTable rows={data?.system} testid="recon-system-summary" /></Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="xl:col-span-2">
          <h3 className="mb-2 text-sm font-semibold">Runs</h3>
          <ListTable endpoint="/reconciliation/runs" testid="recon-runs-table" search={false} size={10} reloadKey={rk} onRowClick={(r) => setRun(r.id)} columns={[
            { key: "created_at", label: "Time", render: (r) => <span className="text-xs">{dt(r.created_at)}</span> },
            { key: "id", label: "Run", mono: true, render: (r) => <span className={run === r.id ? "font-bold text-[#4d7c0f]" : ""}>{r.id}</span> },
            { key: "counts", label: "Result", render: (r) => <span className="text-[11px]">{Object.entries(r.counts || {}).map(([k, v]) => `${k}:${v}`).join(" · ") || "—"}</span> }]} />
        </div>
        <div className="xl:col-span-3">
          <h3 className="mb-2 text-sm font-semibold">Items {run ? `in ${run}` : "(all runs)"}</h3>
          <ListTable key={run || "all"} endpoint="/reconciliation/items" extra={{ run_id: run }} testid="recon-items-table" search={false} reloadKey={rk}
            filters={[{ key: "status", label: "Statuses", options: RECON_STATUSES }]} columns={[
              { key: "created_at", label: "Time", render: (r) => <span className="text-xs">{dt(r.created_at)}</span> },
              { key: "utr", label: "UTR", mono: true }, { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
              { key: "payment_id", label: "Payment", mono: true }, { key: "note", label: "Note", render: (r) => <span className="text-xs">{r.note}</span> },
              { key: "amount", label: "Amount", align: "right", render: (r) => inr(r.amount) }]} />
        </div>
      </div>
    </>
  );
}
