import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Info, RefreshCw } from "lucide-react";
import { useFetch } from "../lib/api";
import { inr, inrShort, istDate, CITIES, TXN_STATUSES, METHODS, label } from "../lib/format";
import { Card, PageHeader, FilterSelect, DateInput } from "../components/kit";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { useMe } from "../context/MeContext";

const PRESETS = [
  { value: "today", label: "Today", r: () => [istDate(0), istDate(0)] },
  { value: "yesterday", label: "Yesterday", r: () => [istDate(1), istDate(1)] },
  { value: "7d", label: "Last 7 days", r: () => [istDate(6), istDate(0)] },
  { value: "30d", label: "Last 30 days", r: () => [istDate(29), istDate(0)] },
  { value: "custom", label: "Custom range" },
];
const PIE = ["#B9F36B", "#111827", "#94A3B8", "#F59E0B", "#EF4444", "#3B82F6", "#10B981"];

const Kpi = ({ k, v, sub, accent = "#B9F36B", testid }) => (
  <div className="relative overflow-hidden rounded-xl border border-[#E2E8F0] bg-white p-4 fade-up" data-testid={testid}>
    <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: accent }} />
    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{k}</div>
    <div className="mt-2 font-mono text-xl font-bold tracking-tight lg:text-2xl" data-testid={`${testid}-value`}>{v}</div>
    {sub && <div className="mt-1 text-[11px] text-slate-400">{sub}</div>}
  </div>
);

function Filters({ f, setF, lookups }) {
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const preset = (v) => {
    const p = PRESETS.find((x) => x.value === v);
    setF((s) => ({ ...s, preset: v, ...(p?.r ? { date_from: p.r()[0], date_to: p.r()[1] } : {}) }));
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white p-3" data-testid="dashboard-filters">
      <FilterSelect value={f.preset} onChange={preset} options={PRESETS.map(({ value, label }) => ({ value, label }))} allLabel="Today" testid="filter-date-preset" />
      {f.preset === "custom" && (<><DateInput value={f.date_from} onChange={(v) => set("date_from", v)} testid="filter-date-from" /><DateInput value={f.date_to} onChange={(v) => set("date_to", v)} testid="filter-date-to" /></>)}
      <FilterSelect value={f.city} onChange={(v) => set("city", v)} options={lookups?.cities || CITIES} placeholder="Cities" testid="filter-city" className="w-36" />
      <FilterSelect value={f.supervisor_id} onChange={(v) => set("supervisor_id", v)} options={(lookups?.supervisors || []).map((s) => ({ value: s.user_id, label: s.name || s.email }))} placeholder="Supervisors" testid="filter-supervisor" />
      <FilterSelect value={f.status} onChange={(v) => set("status", v)} options={TXN_STATUSES} placeholder="Statuses" testid="filter-status" className="w-36" />
      <FilterSelect value={f.method} onChange={(v) => set("method", v)} options={METHODS} placeholder="Methods" testid="filter-method" className="w-36" />
      <Input placeholder="Vehicle no." value={f.vehicle_reg || ""} onChange={(e) => set("vehicle_reg", e.target.value.toUpperCase())} className="h-9 w-32 text-sm" data-testid="filter-vehicle" />
      <Input placeholder="Driver ID" value={f.driver_id || ""} onChange={(e) => set("driver_id", e.target.value.toUpperCase())} className="h-9 w-28 text-sm" data-testid="filter-driver" />
    </div>
  );
}

export default function Dashboard() {
  const { isFinance } = useMe();
  const [f, setF] = useState({ preset: "today", date_from: istDate(0), date_to: istDate(0) });
  const { preset, ...params } = f;
  const { data, loading, reload } = useFetch("/admin/dashboard", params);
  const { data: lookups } = useFetch("/admin/lookups");
  const k = data?.kpis || {};
  const tip = { contentStyle: { borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12 } };
  return (
    <>
      <PageHeader title="Collections overview" subtitle={data ? `${data.range.from} → ${data.range.to} · IST` : "Loading…"}>
        <Button variant="outline" size="sm" onClick={reload} data-testid="dashboard-refresh-btn"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
      </PageHeader>
      {data?.demo_data && (
        <div className="flex items-start gap-2 rounded-lg border border-dashed border-[#1D4ED8]/40 bg-[#EFF6FF] px-4 py-2.5 text-xs text-[#1D4ED8]" data-testid="demo-data-banner">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />DEMO data: drivers/vehicles are sample records until MyVolt is connected. {inr(k.simulated_collection)} of collections in this period are SIMULATED (mock provider) — not real money.
        </div>
      )}
      <Filters f={f} setF={setF} lookups={lookups} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi k="Expected" v={inr(k.expected_collection)} sub={`${data?.range.days || 1} day(s) rent`} testid="kpi-expected" accent="#111827" />
        <Kpi k="Collected" v={inr(k.successful_collection)} sub={`${k.verified_payments || 0} verified payments`} testid="kpi-successful" />
        <Kpi k="Pending" v={inr(k.pending_collection)} testid="kpi-pending" accent="#F59E0B" />
        <Kpi k="Efficiency" v={`${k.collection_efficiency ?? 0}%`} testid="kpi-efficiency" />
        <Kpi k="Outstanding" v={inr(k.outstanding_amount)} sub="MyVolt mirror" testid="kpi-outstanding" accent="#EF4444" />
        <Kpi k="Verified payments" v={k.verified_payments ?? 0} testid="kpi-verified" />
        <Kpi k="Active drivers" v={k.active_drivers ?? 0} testid="kpi-active-drivers" accent="#94A3B8" />
        <Kpi k="Active vehicles" v={k.active_vehicles ?? 0} testid="kpi-active-vehicles" accent="#94A3B8" />
        <Kpi k="Failed txns" v={k.failed_transactions ?? 0} testid="kpi-failed" accent="#EF4444" />
        <Kpi k="Unmatched bank txns" v={k.unmatched_transactions ?? 0} testid="kpi-unmatched" accent="#3B82F6" />
        <Kpi k="Open exceptions" v={k.open_exceptions ?? 0} testid="kpi-open-exceptions" accent="#F59E0B" />
        <Kpi k="Simulated share" v={inrShort(k.simulated_collection)} sub="excluded from bank recon" testid="kpi-simulated" accent="#3B82F6" />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Daily collection" className="xl:col-span-2" testid="chart-daily">
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={data?.daily || []}>
              <defs><linearGradient id="lime" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#B9F36B" stopOpacity={0.7} /><stop offset="100%" stopColor="#B9F36B" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid stroke="#F1F5F9" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} /><YAxis tick={{ fontSize: 11 }} tickFormatter={inrShort} width={60} />
              <Tooltip {...tip} formatter={(v) => inr(v)} /><Area type="monotone" dataKey="amount" name="Collected" stroke="#4d7c0f" strokeWidth={2} fill="url(#lime)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Reconciliation status" testid="chart-reconciliation">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart><Pie data={data?.reconciliation || []} dataKey="count" nameKey="status" innerRadius={55} outerRadius={90} paddingAngle={2}>
              {(data?.reconciliation || []).map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}</Pie>
              <Tooltip {...tip} formatter={(v, n) => [v, label(n)]} /><Legend formatter={label} wrapperStyle={{ fontSize: 11 }} /></PieChart>
          </ResponsiveContainer>
        </Card>
        <Card title="City-wise: collected vs expected" className="xl:col-span-2" testid="chart-city">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data?.cities || []}><CartesianGrid stroke="#F1F5F9" vertical={false} /><XAxis dataKey="city" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={inrShort} width={60} />
              <Tooltip {...tip} formatter={(v) => inr(v)} /><Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="expected" name="Expected" fill="#E2E8F0" radius={[4, 4, 0, 0]} /><Bar dataKey="collected" name="Collected" fill="#111827" radius={[4, 4, 0, 0]} /></BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Successful vs failed" testid="chart-success-failed">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data?.daily || []}><XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(8)} /><YAxis tick={{ fontSize: 11 }} width={35} /><Tooltip {...tip} />
              <Bar dataKey="success" stackId="a" name="Success" fill="#B9F36B" /><Bar dataKey="failed" stackId="a" name="Failed" fill="#EF4444" radius={[3, 3, 0, 0]} /></BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Monthly collection (12 months)" className="xl:col-span-2" testid="chart-monthly">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={data?.monthly || []}><CartesianGrid stroke="#F1F5F9" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={inrShort} width={60} />
              <Tooltip {...tip} formatter={(v) => inr(v)} /><Bar dataKey="amount" name="Collected" fill="#B9F36B" stroke="#4d7c0f" radius={[4, 4, 0, 0]} /></BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Outstanding by city" testid="chart-outstanding">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={data?.cities || []} layout="vertical"><XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={inrShort} /><YAxis type="category" dataKey="city" tick={{ fontSize: 11 }} width={80} />
              <Tooltip {...tip} formatter={(v) => inr(v)} /><Bar dataKey="outstanding" name="Outstanding" fill="#EF4444" radius={[0, 4, 4, 0]} /></BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
      {!isFinance && <p className="text-xs text-slate-400">Figures limited to your assigned cities.</p>}
    </>
  );
}
