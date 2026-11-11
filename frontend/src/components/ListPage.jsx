import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "./ui/input";
import { useFetch } from "../lib/api";
import { DataTable, Pager } from "./DataTable";
import { FilterSelect, DateInput } from "./kit";

// Generic searchable, filterable, paginated list bound to a backend endpoint returning {items,total,page,size}.
export function ListTable({ endpoint, columns, filters = [], search = true, onRowClick, testid, reloadKey, extra = {}, size = 25, onData }) {
  const [state, setState] = useState({ page: 1 });
  const [q, setQ] = useState("");
  const set = (k, v) => setState((s) => ({ ...s, [k]: v, page: k === "page" ? v : 1 }));
  useEffect(() => {
    const t = setTimeout(() => setState((s) => (s.q === q ? s : { ...s, q, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, loading, error, reload } = useFetch(endpoint, { ...extra, ...state, size });
  useEffect(() => { if (reloadKey) reload(); }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (data && onData) onData(data); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-3 fade-up">
      <div className="flex flex-wrap items-center gap-2">
        {search && (
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input placeholder="Search…" className="h-9 w-64 bg-white pl-8 text-sm" value={q} onChange={(e) => setQ(e.target.value)} data-testid={`${testid}-search`} />
          </div>
        )}
        {filters.map((f) =>
          f.type === "date" ? (
            <DateInput key={f.key} value={state[f.key]} onChange={(v) => set(f.key, v)} testid={`${testid}-filter-${f.key}`} />
          ) : (
            <FilterSelect key={f.key} value={state[f.key]} onChange={(v) => set(f.key, v)} options={f.options} placeholder={f.label} testid={`${testid}-filter-${f.key}`} />
          )
        )}
      </div>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" data-testid={`${testid}-error`}>{error}</p>}
      <DataTable columns={columns} rows={data?.items} loading={loading} onRowClick={onRowClick} testid={testid} />
      <Pager page={state.page} size={size} total={data?.total} onPage={(p) => set("page", p)} testid={`${testid}-pager`} />
    </div>
  );
}
