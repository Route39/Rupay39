import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader, StatusBadge, Field, FilterSelect, Card } from "../components/kit";
import { ListTable } from "../components/ListPage";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../components/ui/sheet";
import { useApi, useFetch, errMsg } from "../lib/api";
import { inr, dt, label, CITIES } from "../lib/format";
import { useMe } from "../context/MeContext";

const TYPES = ["UNMATCHED_BANK_TXN", "AMOUNT_MISMATCH", "DUPLICATE_TRANSACTION", "AMBIGUOUS_MATCH", "DELAYED_CONFIRMATION", "REVERSAL", "REFUND",
  "FAILED_PAYMENT", "DRIVER_DISPUTE", "MYVOLT_SYNC_FAILED", "MERCHANT_MISMATCH", "UNMATCHED_PROVIDER_EVENT"];
const OPERATIONAL = ["DRIVER_DISPUTE", "FAILED_PAYMENT", "DELAYED_CONFIRMATION", "MYVOLT_SYNC_FAILED"];

function ResolveForm({ exc, candidates, onDone }) {
  const api = useApi();
  const { isFinance } = useMe();
  const actions = [
    ...(isFinance && exc.bank_txn_id ? [{ value: "LINK_TO_PAYMENT", label: "Link bank credit to payment request" }] : []),
    ...(exc.type === "MYVOLT_SYNC_FAILED" ? [{ value: "RETRY_SYNC", label: "Retry MyVolt sync" }] : []),
    { value: "CLOSE_NO_ACTION", label: "Close – no financial change" },
  ];
  const [f, setF] = useState({ action: actions[0].value, payment_id: candidates?.[0]?.id || "", reason: "", evidence_ref: "" });
  const canResolve = isFinance || OPERATIONAL.includes(exc.type);
  const submit = async () => {
    try {
      await api.post(`/exceptions/${exc.id}/resolve`, f);
      toast.success("Exception resolved");
      onDone();
    } catch (e) { toast.error(errMsg(e)); }
  };
  if (!canResolve) return <p className="text-xs text-amber-700" data-testid="resolve-not-allowed">This exception needs Finance review. Add a comment or escalate.</p>;
  return (
    <div className="space-y-3" data-testid="resolve-form">
      <div><Label className="text-xs">Action</Label><FilterSelect value={f.action} onChange={(v) => setF({ ...f, action: v === "ALL" ? actions[0].value : v })} options={actions} allLabel="Select" className="w-full" testid="resolve-action-select" /></div>
      {f.action === "LINK_TO_PAYMENT" && <div><Label className="text-xs">Payment request ID</Label><Input value={f.payment_id} onChange={(e) => setF({ ...f, payment_id: e.target.value })} placeholder="PAY-…" data-testid="resolve-payment-id-input" /></div>}
      <div><Label className="text-xs">Reason (required)</Label><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} data-testid="resolve-reason-input" /></div>
      <div><Label className="text-xs">Supporting evidence reference {f.action === "LINK_TO_PAYMENT" ? "(required)" : ""}</Label><Input value={f.evidence_ref} onChange={(e) => setF({ ...f, evidence_ref: e.target.value })} placeholder="e.g. Kotak MIS row / ticket no." data-testid="resolve-evidence-input" /></div>
      <Button onClick={submit} className="w-full bg-[#111827]" data-testid="resolve-submit-btn">Resolve</Button>
    </div>
  );
}

function ExceptionSheet({ id, onClose, onChanged }) {
  const api = useApi();
  const { data, reload } = useFetch(id ? `/exceptions/${id}` : null);
  const [comment, setComment] = useState("");
  const e = data?.exception;
  const act = async (path, body, msg) => {
    try { await api.post(`/exceptions/${id}/${path}`, body); toast.success(msg); setComment(""); reload(); onChanged(); } catch (err) { toast.error(errMsg(err)); }
  };
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto bg-white sm:max-w-xl" data-testid="exception-sheet">
        {e && (<>
          <SheetHeader><SheetTitle className="flex items-center gap-2 font-mono text-base">{e.id}<StatusBadge status={e.status} testid="exception-status" /></SheetTitle></SheetHeader>
          <div className="mt-4 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <Field k="Type" v={label(e.type)} /><Field k="Amount" v={e.amount != null ? inr(e.amount) : "—"} mono />
              <Field k="City" v={e.city} /><Field k="Created" v={dt(e.created_at)} />
              <Field k="Payment" v={e.payment_id ? <Link className="underline" to={`/requests/${e.payment_id}`}>{e.payment_id}</Link> : "—"} mono /><Field k="Bank txn" v={e.bank_txn_id} mono />
            </div>
            <p className="rounded-lg bg-[#F8FAFC] p-3 text-sm">{e.details}</p>
            {data.bank_transaction && <Card title="Bank line"><div className="grid grid-cols-2 gap-3"><Field k="UTR" v={data.bank_transaction.utr} mono /><Field k="Amount" v={inr(data.bank_transaction.amount)} mono /><Field k="Payer" v={data.bank_transaction.payer_name} /><Field k="Time" v={dt(data.bank_transaction.txn_time)} /></div></Card>}
            {data.utr_candidates?.length > 0 && <Card title="Requests claiming this UTR"><ul className="space-y-1 text-xs">{data.utr_candidates.map((c) => <li key={c.id} className="font-mono">{c.id} · {c.driver_name} · {inr(c.amount_requested)} · {c.status}</li>)}</ul></Card>}
            {e.resolution && <Card title="Resolution"><div className="grid grid-cols-2 gap-3"><Field k="Action" v={e.resolution.action} /><Field k="By" v={e.resolution.by} /><Field k="At" v={dt(e.resolution.at)} /><Field k="Evidence" v={e.resolution.evidence_ref} /><Field k="Status change" v={`${e.resolution.before_status} → ${e.resolution.after_status}`} /><Field k="Reason" v={e.resolution.reason} /></div></Card>}
            {e.status !== "RESOLVED" && <ResolveForm exc={e} candidates={data.utr_candidates} onDone={() => { reload(); onChanged(); }} />}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Comments</h4>
              {e.comments.map((c, i) => <div key={i} className="rounded-lg border border-[#F1F5F9] p-2 text-xs"><b>{c.by}</b> <span className="text-slate-400">{dt(c.at)}</span><div className="mt-1">{c.text}</div></div>)}
              <Textarea value={comment} onChange={(x) => setComment(x.target.value)} placeholder="Add a comment…" data-testid="exception-comment-input" />
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={!comment} onClick={() => act("comments", { text: comment }, "Comment added")} data-testid="exception-comment-btn">Comment</Button>
                {e.status === "OPEN" && <Button size="sm" variant="outline" disabled={comment.length < 3} onClick={() => act("escalate", { reason: comment }, "Escalated")} data-testid="exception-escalate-btn">Escalate (uses comment as reason)</Button>}
              </div>
            </div>
          </div>
        </>)}
      </SheetContent>
    </Sheet>
  );
}

export default function Exceptions() {
  const [sel, setSel] = useState(null);
  const [rk, setRk] = useState(0);
  const [counts, setCounts] = useState({});
  return (
    <>
      <PageHeader title="Unmatched payments & exceptions" subtitle="Supervisors only handle exceptions. Every manual decision records who, when, status change, reason and evidence." />
      <div className="flex flex-wrap gap-2" data-testid="exception-type-counts">
        {Object.entries(counts).map(([t, n]) => <span key={t} className="rounded-full border border-[#E2E8F0] bg-white px-3 py-1 text-xs"><b className="font-mono">{n}</b> {label(t)}</span>)}
      </div>
      <ListTable endpoint="/exceptions" testid="exceptions-table" reloadKey={rk} extra={{}} onRowClick={(r) => setSel(r.id)} onData={(d) => setCounts(d.open_by_type || {})}
        filters={[{ key: "status", label: "Statuses", options: [{ value: "ACTIVE", label: "Open + escalated" }, "OPEN", "ESCALATED", "RESOLVED"] },
          { key: "type", label: "Types", options: TYPES }, { key: "city", label: "Cities", options: CITIES }]}
        columns={[
          { key: "created_at", label: "Created", render: (r) => <span className="text-xs">{dt(r.created_at)}</span> },
          { key: "id", label: "Exception", mono: true }, { key: "type", label: "Type", render: (r) => <span className="text-xs font-semibold">{label(r.type)}</span> },
          { key: "city", label: "City" }, { key: "details", label: "Details", render: (r) => <span className="line-clamp-1 max-w-xs text-xs text-slate-500">{r.details}</span> },
          { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
          { key: "amount", label: "Amount", align: "right", render: (r) => (r.amount != null ? inr(r.amount) : "—") }]} />
      <ExceptionSheet id={sel} onClose={() => setSel(null)} onChanged={() => setRk((x) => x + 1)} />
    </>
  );
}
