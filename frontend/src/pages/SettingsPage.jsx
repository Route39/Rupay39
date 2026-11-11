import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader, Card } from "../components/kit";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { useApi, useFetch, errMsg } from "../lib/api";
import { useMe } from "../context/MeContext";

const Txt = ({ k, label, f, set, disabled, type = "text" }) => (
  <div><Label className="text-xs">{label}</Label><Input type={type} value={f[k] ?? ""} disabled={disabled} onChange={(e) => set(k, type === "number" ? Number(e.target.value) : e.target.value)} data-testid={`setting-${k}`} /></div>
);
const Tog = ({ k, label, hint, f, set, disabled }) => (
  <div className="flex items-start justify-between gap-4"><div><div className="text-sm font-medium">{label}</div><div className="text-xs text-slate-500">{hint}</div></div>
    <Switch checked={!!f[k]} disabled={disabled} onCheckedChange={(v) => set(k, v)} data-testid={`setting-${k}`} /></div>
);

export default function SettingsPage() {
  const api = useApi();
  const { isSuper } = useMe();
  const { data } = useFetch("/settings");
  const [f, setF] = useState({});
  useEffect(() => { if (data) setF({ ...data, settlement_keywords: (data.settlement_keywords || []).join(", ") }); }, [data]);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    const keys = ["brand_name", "brand_tagline", "logo_url", "payment_expiry_minutes", "allow_partial_payments", "static_qr_image_url", "static_qr_vpa",
      "static_qr_merchant_name", "myvolt_simulate_failure", "support_contact"];
    try {
      await api.patch("/settings", { ...Object.fromEntries(keys.map((k) => [k, f[k]])), settlement_keywords: String(f.settlement_keywords).split(",").map((s) => s.trim()).filter(Boolean) });
      toast.success("Settings saved");
    } catch (e) { toast.error(errMsg(e)); }
  };
  const d = !isSuper;
  const p = { f, set, disabled: d };
  return (
    <>
      <PageHeader title="Settings" subtitle={d ? "View only — Super Admin can edit." : "Changes are audit-logged."}>
        {isSuper && <Button onClick={save} className="bg-[#B9F36B] text-[#111827] hover:bg-[#a3e635]" data-testid="settings-save-btn">Save settings</Button>}
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Brand (configurable until trademark clearance)"><div className="space-y-3"><Txt k="brand_name" label="Product name" {...p} /><Txt k="brand_tagline" label="Endorsement line" {...p} /><Txt k="logo_url" label="Logo URL" {...p} /></div></Card>
        <Card title="Payment rules"><div className="space-y-4">
          <Txt k="payment_expiry_minutes" label="Dynamic payment request expiry (minutes)" type="number" {...p} />
          <Tog k="allow_partial_payments" label="Allow partial payments" hint="Off: any amount other than the authorised payable is rejected / sent to exceptions. Enable only if MyVolt rental rules allow it." {...p} />
        </div></Card>
        <Card title="Static QR (interim Kotak merchant QR)"><div className="space-y-3">
          <Txt k="static_qr_image_url" label="QR image URL (shown in EV Rent)" {...p} /><Txt k="static_qr_vpa" label="Merchant VPA" {...p} /><Txt k="static_qr_merchant_name" label="Payee name" {...p} />
          <p className="text-xs text-slate-500">Static QR payments are confirmed only when the bank statement UTR matches the driver's claimed UTR. Screenshots are never proof.</p>
        </div></Card>
        <Card title="Reconciliation & integrations"><div className="space-y-4">
          <Txt k="settlement_keywords" label="Settlement narration keywords (comma separated)" {...p} />
          <Tog k="myvolt_simulate_failure" label="Simulate MyVolt outage (testing)" hint="Mock MyVolt rejects sync so you can test the retry queue and SYNC_FAILED exceptions." {...p} />
          <Txt k="support_contact" label="Support contact shown on receipts" {...p} />
        </div></Card>
      </div>
    </>
  );
}
