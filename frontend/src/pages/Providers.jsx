import { useState } from "react";
import { toast } from "sonner";
import { ShieldAlert, Star } from "lucide-react";
import { PageHeader, StatusBadge, Field, Card } from "../components/kit";
import { Switch } from "../components/ui/switch";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useApi, useFetch, errMsg } from "../lib/api";
import { useMe } from "../context/MeContext";

function CredForm({ code, onSaved }) {
  const api = useApi();
  const [k, setK] = useState("");
  const [v, setV] = useState("");
  const save = async () => {
    try { await api.patch(`/providers/${code}`, { credentials: { [k]: v } }); toast.success("Stored encrypted"); setK(""); setV(""); onSaved(); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Input placeholder="Field (e.g. merchant_id)" value={k} onChange={(e) => setK(e.target.value)} className="h-8 w-44 text-xs" data-testid={`cred-key-${code}`} />
      <Input placeholder="Value (write-only)" type="password" value={v} onChange={(e) => setV(e.target.value)} className="h-8 w-44 text-xs" data-testid={`cred-value-${code}`} />
      <Button size="sm" variant="outline" disabled={!k || !v} onClick={save} data-testid={`cred-save-${code}`}>Save encrypted</Button>
    </div>
  );
}

export default function Providers() {
  const api = useApi();
  const { isSuper } = useMe();
  const { data, reload } = useFetch("/providers");
  const patch = async (code, body) => {
    try { await api.patch(`/providers/${code}`, body); toast.success("Provider updated"); reload(); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <>
      <PageHeader title="Payment providers" subtitle="Provider-independent adapter layer. Add a new approved provider without touching the payment engine." />
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800" data-testid="kotak-notice">
        <ShieldAlert className="h-4 w-4 shrink-0" />Kotak live APIs are not assumed. The Kotak adapter stays disabled until Kotak supplies approved API documentation, credentials, commercial terms and production access. No Kotak endpoints or payload formats have been invented.
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {(data || []).map((p) => (
          <Card key={p.code} testid={`provider-card-${p.code}`} title={<span className="flex items-center gap-2">{p.name}{p.is_primary && <Star className="h-3.5 w-3.5 fill-[#B9F36B] text-[#4d7c0f]" />}</span>}
            action={<Switch checked={p.enabled} disabled={!isSuper || p.code === "KOTAK"} onCheckedChange={(v) => patch(p.code, { enabled: v })} data-testid={`provider-enabled-${p.code}`} />}>
            <div className="grid grid-cols-2 gap-3">
              <Field k="Code" v={p.code} mono /><Field k="Mode" v={<StatusBadge status={p.is_simulated ? "SIMULATED" : p.mode} />} />
              <Field k="Status" v={<StatusBadge status={p.status} />} /><Field k="Methods" v={p.methods.join(", ")} />
              <Field k="Callback URL" v={p.supports_callbacks || p.code === "KOTAK" ? p.webhook_path : "Bank statement only"} mono />
              <Field k="Stored credentials" v={p.credential_fields.length ? p.credential_fields.join(", ") : "None"} mono />
            </div>
            <p className="mt-3 text-xs text-slate-500">{p.notes}</p>
            {isSuper && (
              <div className="mt-4 space-y-2 border-t border-[#F1F5F9] pt-3">
                {!p.is_primary && p.enabled && <Button size="sm" variant="outline" onClick={() => patch(p.code, { is_primary: true })} data-testid={`provider-primary-${p.code}`}>Make primary</Button>}
                <CredForm code={p.code} onSaved={reload} />
              </div>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
