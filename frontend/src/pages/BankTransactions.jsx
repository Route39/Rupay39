import { useState } from "react";
import { toast } from "sonner";
import { Upload, CheckCircle2 } from "lucide-react";
import { PageHeader, StatusBadge, FilterSelect, Field } from "../components/kit";
import { ListTable } from "../components/ListPage";
import { DataTable } from "../components/DataTable";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { useApi, errMsg } from "../lib/api";
import { inr, dt, label, RECON_STATUSES } from "../lib/format";

const STEPS = ["Upload", "Map columns", "Preview", "Result"];
const FIELD_HELP = { utr: "Bank UTR / RRN (required for matching)", amount: "Amount (or use credit/debit)", txn_time: "Transaction date/time" };

function ImportWizard({ open, onOpenChange, onDone }) {
  const api = useApi();
  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const reset = () => { setStep(0); setFile(null); setPreview(null); setMapping({}); setResult(null); };
  const upload = async () => {
    const fd = new FormData();
    fd.append("file", file);
    setBusy(true);
    try {
      const r = await api.post("/bank/preview", fd);
      setPreview(r.data);
      setMapping(r.data.suggested_mapping);
      setStep(1);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const doImport = async () => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("mapping", JSON.stringify(mapping));
    fd.append("source", "KOTAK_STATEMENT");
    setBusy(true);
    try {
      const r = await api.post("/bank/import", fd);
      setResult(r.data);
      setStep(3);
      onDone();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-3xl bg-white" data-testid="import-wizard">
        <DialogHeader><DialogTitle>Import bank statement</DialogTitle></DialogHeader>
        <div className="flex gap-2">{STEPS.map((s, i) => (
          <div key={s} className={`flex-1 border-t-2 pt-2 text-[11px] font-semibold ${i <= step ? "border-[#111827] text-[#111827]" : "border-slate-200 text-slate-400"}`}>{i + 1}. {s}</div>))}</div>
        {step === 0 && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">Upload the Kotak merchant transaction report or account statement (.csv / .xlsx). Re-importing the same rows is safe — exact duplicates are skipped.</p>
            <Input type="file" accept=".csv,.xlsx" onChange={(e) => setFile(e.target.files[0])} data-testid="import-file-input" />
            <Button disabled={!file || busy} onClick={upload} className="bg-[#111827]" data-testid="import-upload-btn"><Upload className="mr-1.5 h-4 w-4" />Read file</Button>
          </div>
        )}
        {step === 1 && preview && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">{preview.row_count} rows found. Map each RUPAY39 field to a column in the file.</p>
            <div className="grid max-h-[50vh] grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2">
              {preview.target_fields.map((f) => (
                <div key={f}><Label className="text-xs">{label(f)} <span className="text-slate-400">{FIELD_HELP[f] || ""}</span></Label>
                  <FilterSelect value={mapping[f]} onChange={(v) => setMapping({ ...mapping, [f]: v === "ALL" ? undefined : v })} options={preview.headers.map((h) => ({ value: h, label: h }))} allLabel="— not mapped —" className="w-full" testid={`map-${f}`} /></div>
              ))}
            </div>
            <Button onClick={() => setStep(2)} className="bg-[#111827]" data-testid="import-next-preview-btn">Preview</Button>
          </div>
        )}
        {step === 2 && preview && (
          <div className="space-y-3">
            <DataTable testid="import-preview-table" rows={preview.sample.map((s, i) => ({ id: i, ...Object.fromEntries(Object.entries(mapping).filter(([, c]) => c).map(([f, c]) => [f, s[c]])) }))}
              columns={Object.keys(mapping).filter((f) => mapping[f]).map((f) => ({ key: f, label: label(f) }))} />
            <p className="text-xs text-amber-700">Matching uses only the bank UTR. Rows without a UTR, or with UTRs claimed by more than one request, go to the exception queue — never auto-assigned by amount or time.</p>
            <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button disabled={busy} onClick={doImport} className="bg-[#B9F36B] text-[#111827] hover:bg-[#a3e635]" data-testid="import-confirm-btn">Import & reconcile</Button></div>
          </div>
        )}
        {step === 3 && result && (
          <div className="space-y-4" data-testid="import-result">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#047857]"><CheckCircle2 className="h-5 w-5" />Import {result.import_id} complete</div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <Field k="Rows" v={result.rows} /><Field k="Imported" v={result.imported} /><Field k="Duplicate rows skipped" v={result.skipped_duplicate_rows} />
              <Field k="Invalid" v={result.invalid} /><Field k="Settlement credits" v={result.settlements} />
            </div>
            <div className="flex flex-wrap gap-2">{Object.entries(result.reconciliation?.counts || {}).map(([k, v]) => <span key={k} className="flex items-center gap-1.5 text-xs"><StatusBadge status={k} />{v}</span>)}</div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function BankTransactions() {
  const [open, setOpen] = useState(false);
  const [rk, setRk] = useState(0);
  return (
    <>
      <PageHeader title="Bank transactions" subtitle="Imported Kotak statement lines. Settlement credits are kept separate from individual driver payments.">
        <Button onClick={() => setOpen(true)} className="bg-[#B9F36B] text-[#111827] hover:bg-[#a3e635]" data-testid="open-import-btn"><Upload className="mr-1.5 h-4 w-4" />Import statement</Button>
      </PageHeader>
      <ListTable endpoint="/bank/transactions" testid="bank-table" reloadKey={rk}
        filters={[{ key: "recon_status", label: "Recon", options: [...RECON_STATUSES, "SETTLEMENT"] }, { key: "entry_type", label: "Types", options: ["TRANSACTION", "SETTLEMENT"] },
          { key: "date_from", type: "date" }, { key: "date_to", type: "date" }]}
        columns={[
          { key: "txn_time", label: "Bank time", render: (r) => <span className="text-xs">{dt(r.txn_time)}</span> },
          { key: "utr", label: "UTR", mono: true }, { key: "payer_name", label: "Payer", render: (r) => <div><div>{r.payer_name || "—"}</div><div className="text-[11px] text-slate-400">{r.payer_vpa}</div></div> },
          { key: "description", label: "Narration", render: (r) => <span className="text-xs text-slate-500">{r.description}</span> },
          { key: "entry_type", label: "Type", render: (r) => <span className="text-xs">{r.entry_type} · {r.direction}</span> },
          { key: "recon_status", label: "Recon", render: (r) => <StatusBadge status={r.recon_status} /> },
          { key: "matched_payment_id", label: "Matched payment", mono: true }, { key: "source", label: "Source", render: (r) => <span className="text-[11px]">{r.source}</span> },
          { key: "amount", label: "Amount", align: "right", render: (r) => inr(r.amount) },
        ]} />
      <ImportWizard open={open} onOpenChange={setOpen} onDone={() => setRk((x) => x + 1)} />
    </>
  );
}
