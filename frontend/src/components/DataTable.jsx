import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Empty } from "./kit";

export function DataTable({ columns, rows, loading, onRowClick, testid = "data-table", rowKey = "id" }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white" data-testid={testid}>
      <table className="w-full min-w-[720px] text-sm">
        <thead className="sticky top-0 bg-[#F8FAFC]">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`border-b border-[#E2E8F0] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 ${c.align === "right" ? "text-right" : "text-left"}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && !rows?.length && (
            <tr><td colSpan={columns.length}><div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div></td></tr>
          )}
          {!loading && !rows?.length && <tr><td colSpan={columns.length}><Empty /></td></tr>}
          {rows?.map((r, i) => (
            <tr
              key={r[rowKey] || i}
              data-testid={`${testid}-row-${r[rowKey] || i}`}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={`border-b border-[#F1F5F9] last:border-0 transition-colors ${onRowClick ? "cursor-pointer hover:bg-[#B9F36B]/10" : ""}`}
            >
              {columns.map((c) => (
                <td key={c.key} className={`px-4 py-2.5 align-middle ${c.align === "right" ? "text-right font-mono" : ""} ${c.mono ? "font-mono text-xs" : ""}`}>
                  {c.render ? c.render(r) : r[c.key] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ page, size, total, onPage, testid = "pager" }) {
  const pages = Math.max(1, Math.ceil((total || 0) / size));
  return (
    <div className="flex items-center justify-between text-xs text-slate-500" data-testid={testid}>
      <span>{total ?? 0} records · page {page} of {pages}</span>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid={`${testid}-prev`}><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} data-testid={`${testid}-next`}><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}
