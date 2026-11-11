import { useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, FileText, Printer } from "lucide-react";
import { PageHeader, FilterSelect, DateInput } from "../components/kit";
import { DataTable } from "../components/DataTable";
import { Button } from "../components/ui/button";
import { useApi, useFetch, download, errMsg } from "../lib/api";
import { inr, istDate, CITIES } from "../lib/format";
import { useMe } from "../context/MeContext";

const isMoney = (k) => /amount|difference|rent|payable/.test(k);

export default function Reports() {
  const api = useApi();
  const { brand } = useMe();
  const { data: list } = useFetch("/reports");
  const [p, setP] = useState({ type: "daily_collection", date_from: istDate(29), date_to: istDate(0), city: "" });
  const { type, ...params } = p;
  const { data, loading } = useFetch(`/reports/${type}`, params);
  const exp = async (format) => {
    try { await download(api, `/reports/${type}`, { ...params, format }, `rupay39_${type}.${format}`); } catch (e) { toast.error(errMsg(e)); }
  };
  const cols = (data?.columns || []).map((c) => ({ key: c.key, label: c.label, align: isMoney(c.key) ? "right" : undefined,
    render: isMoney(c.key) ? (r) => inr(r[c.key]) : undefined }));
  const total = (data?.rows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  return (
    <>
      <PageHeader title="Finance reports" subtitle="All figures computed from database records. Exports are audit-logged.">
        <div className="no-print flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exp("csv")} data-testid="export-csv-btn"><FileText className="mr-1.5 h-4 w-4" />CSV</Button>
          <Button variant="outline" size="sm" onClick={() => exp("xlsx")} data-testid="export-xlsx-btn"><FileSpreadsheet className="mr-1.5 h-4 w-4" />Excel</Button>
          <Button size="sm" className="bg-[#111827]" onClick={() => window.print()} data-testid="export-pdf-btn"><Printer className="mr-1.5 h-4 w-4" />Print / PDF</Button>
        </div>
      </PageHeader>
      <div className="no-print flex flex-wrap gap-2 rounded-xl border border-[#E2E8F0] bg-white p-3">
        <FilterSelect value={p.type} onChange={(v) => setP({ ...p, type: v === "ALL" ? "daily_collection" : v })} options={(list || []).map((r) => ({ value: r.type, label: r.name }))} allLabel="Daily collection" className="w-64" testid="report-type-select" />
        <DateInput value={p.date_from} onChange={(v) => setP({ ...p, date_from: v })} testid="report-date-from" />
        <DateInput value={p.date_to} onChange={(v) => setP({ ...p, date_to: v })} testid="report-date-to" />
        <FilterSelect value={p.city} onChange={(v) => setP({ ...p, city: v })} options={CITIES} placeholder="Cities" testid="report-city-select" />
      </div>
      <div className="hidden print:block">
        <h2 className="text-xl font-bold">{brand.brand_name} · {data?.name}</h2>
        <p className="text-xs">{p.date_from} to {p.date_to} {p.city && p.city !== "ALL" ? `· ${p.city}` : ""} · generated {new Date().toLocaleString("en-IN")}</p>
      </div>
      <div className="flex items-center justify-between text-sm">
        <b data-testid="report-name">{data?.name}</b>
        <span className="font-mono text-xs text-slate-500" data-testid="report-total">{data?.rows?.length || 0} rows{total ? ` · total ${inr(total)}` : ""}</span>
      </div>
      <DataTable columns={cols} rows={(data?.rows || []).map((r, i) => ({ ...r, id: r.id || `${i}` }))} loading={loading} testid="report-table" />
    </>
  );
}
