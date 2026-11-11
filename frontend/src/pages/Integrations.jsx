import { useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, KeyRound, RotateCcw } from "lucide-react";
import { PageHeader, StatusBadge, Card, FilterSelect } from "../components/kit";
import { ListTable } from "../components/ListPage";
import { DataTable } from "../components/DataTable";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { useApi, useFetch, errMsg, API } from "../lib/api";
import { dt, label } from "../lib/format";
import { useMe } from "../context/MeContext";

function ApiClients() {
  const api = useApi();
  const { data, reload } = useFetch("/api-clients");
  const [name, setName] = useState("");
  const [system, setSystem] = useState("EV_RENT");
  const [key, setKey] = useState(null);
  const create = async () => {
    try { const r = await api.post("/api-clients", { name, system }); setKey(r.data.api_key); setName(""); reload(); } catch (e) { toast.error(errMsg(e)); }
  };
  const revoke = async (id) => { try { await api.post(`/api-clients/${id}/revoke`); reload(); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <Card title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4" />Service API keys</span>} testid="api-clients-card">
      <div className="mb-4 flex flex-wrap gap-2">
        <Input placeholder="Client name (e.g. EV Rent backend)" value={name} onChange={(e) => setName(e.target.value)} className="h-9 w-64" data-testid="api-client-name-input" />
        <FilterSelect value={system} onChange={(v) => setSystem(v === "ALL" ? "EV_RENT" : v)} options={["EV_RENT", "MYVOLT", "OTHER"]} allLabel="System" testid="api-client-system-select" />
        <Button onClick={create} disabled={name.length < 2} className="bg-[#111827]" data-testid="api-client-create-btn">Issue key</Button>
      </div>
      {key && (
        <div className="mb-4 rounded-lg border border-[#B9F36B] bg-[#B9F36B]/15 p-3 text-xs" data-testid="api-key-reveal">
          <b>Copy now — shown only once.</b> Send it as header <code>X-API-Key</code> from the EV Rent backend (never from the mobile app).
          <div className="mt-2 flex items-center gap-2"><code className="break-all font-mono">{key}</code>
            <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(key); toast.success("Copied"); }} data-testid="api-key-copy-btn"><Copy className="h-3.5 w-3.5" /></Button></div>
        </div>
      )}
      <DataTable testid="api-clients-table" rows={data} columns={[
        { key: "name", label: "Name" }, { key: "system", label: "System" }, { key: "key_prefix", label: "Key prefix", mono: true },
        { key: "active", label: "Status", render: (r) => <StatusBadge status={r.active ? "ACTIVE" : "INACTIVE"} /> },
        { key: "last_used_at", label: "Last used", render: (r) => <span className="text-xs">{dt(r.last_used_at)}</span> },
        { key: "x", label: "", render: (r) => r.active && <Button size="sm" variant="outline" onClick={() => revoke(r.id)} data-testid={`api-client-revoke-${r.id}`}>Revoke</Button> }]} />
    </Card>
  );
}

function SyncLogs({ target }) {
  const api = useApi();
  const [rk, setRk] = useState(0);
  const retry = async (id) => { try { await api.post(`/sync-logs/${target}/${id}/retry`); toast.success("Queued for retry"); setRk((x) => x + 1); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <ListTable endpoint={`/sync-logs/${target}`} testid={`sync-${target}-table`} search={false} reloadKey={rk}
      filters={[{ key: "status", label: "Statuses", options: ["SYNC_PENDING", "SYNCED", "RETRY_PENDING", "SYNC_FAILED"] }]}
      columns={[
        { key: "created_at", label: "Queued", render: (r) => <span className="text-xs">{dt(r.created_at)}</span> },
        { key: "event_type", label: "Event", mono: true }, { key: "payment_id", label: "Payment", mono: true },
        { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> }, { key: "attempts", label: "Attempts" },
        { key: "last_error", label: "Last error", render: (r) => <span className="text-xs text-red-600">{r.last_error || "—"}</span> },
        { key: "response", label: "Response", render: (r) => <span className="text-[11px] text-slate-500">{r.response?.simulated ? "MOCK ack" : r.response ? "OK" : "—"}</span> },
        { key: "x", label: "", render: (r) => ["SYNC_FAILED", "RETRY_PENDING"].includes(r.status) && <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); retry(r.id); }} data-testid={`sync-retry-${r.id}`}><RotateCcw className="h-3.5 w-3.5" /></Button> }]} />
  );
}

export default function Integrations() {
  const { isSuper } = useMe();
  return (
    <>
      <PageHeader title="API integrations" subtitle="EV Rent partner APIs, MyVolt sync outbox and provider callbacks. All cross-system communication is via authenticated APIs only.">
        <a href={`${API}/docs`} target="_blank" rel="noreferrer"><Button variant="outline" size="sm" data-testid="open-api-docs-btn"><ExternalLink className="mr-1.5 h-4 w-4" />OpenAPI / Swagger</Button></a>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-3">
        {[["EV Rent → RUPAY39", "POST /api/v1/payments/create · GET /api/v1/payments/{id} · /receipt · /instructions · POST /utr · /dispute · GET /api/v1/drivers/{id}/payments · /outstanding · GET /api/v1/transactions/check"],
          ["RUPAY39 → MyVolt", "Verified payment events via outbox with Idempotency-Key. Set MYVOLT_PAYMENT_SYNC_URL + MYVOLT_API_KEY once MyVolt shares its endpoint; until then a MOCK acknowledges."],
          ["Provider → RUPAY39", "POST /api/webhooks/{PROVIDER}. Signature verified before any processing; duplicate callbacks are ignored by event id."]].map(([t, d]) => (
          <Card key={t} title={t}><p className="font-mono text-[11px] leading-relaxed text-slate-600">{d}</p></Card>))}
      </div>
      {isSuper && <ApiClients />}
      <Tabs defaultValue="myvolt" className="space-y-3">
        <TabsList className="bg-white">
          <TabsTrigger value="myvolt" data-testid="tab-myvolt-sync">MyVolt sync</TabsTrigger>
          <TabsTrigger value="evrent" data-testid="tab-evrent-sync">EV Rent notifications</TabsTrigger>
          <TabsTrigger value="hooks" data-testid="tab-webhook-log">Provider callbacks</TabsTrigger>
        </TabsList>
        <TabsContent value="myvolt"><SyncLogs target="myvolt" /></TabsContent>
        <TabsContent value="evrent"><SyncLogs target="evrent" /></TabsContent>
        <TabsContent value="hooks">
          <ListTable endpoint="/webhooks" testid="webhooks-table" search={false} columns={[
            { key: "received_at", label: "Received", render: (r) => <span className="text-xs">{dt(r.received_at)}</span> },
            { key: "provider", label: "Provider" }, { key: "event_key", label: "Event", mono: true },
            { key: "signature_valid", label: "Signature", render: (r) => <StatusBadge status={r.signature_valid ? "MATCHED" : "FAILED"} /> },
            { key: "result", label: "Result", render: (r) => <span className="text-xs">{label(r.result)}</span> }, { key: "duplicate_count", label: "Dupes ignored" }]} />
        </TabsContent>
      </Tabs>
    </>
  );
}
