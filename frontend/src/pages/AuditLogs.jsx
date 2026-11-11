import { PageHeader, StatusBadge } from "../components/kit";
import { ListTable } from "../components/ListPage";
import { dt } from "../lib/format";

export default function AuditLogs() {
  return (
    <>
      <PageHeader title="Audit logs" subtitle="Immutable record of every financial event and manual decision." />
      <ListTable endpoint="/audit-logs" testid="audit-table" size={50} columns={[
        { key: "created_at", label: "Time", render: (r) => <span className="text-xs">{dt(r.created_at)}</span> },
        { key: "action", label: "Action", render: (r) => <span className="font-mono text-xs font-semibold">{r.action}</span> },
        { key: "actor_email", label: "Actor", render: (r) => <div><div className="text-xs">{r.actor_email}</div><div className="text-[10px] text-slate-400">{r.actor_role}</div></div> },
        { key: "entity_id", label: "Entity", mono: true, render: (r) => <span>{r.entity_type}: {r.entity_id}</span> },
        { key: "before_status", label: "From", render: (r) => <StatusBadge status={r.before_status} /> },
        { key: "after_status", label: "To", render: (r) => <StatusBadge status={r.after_status} /> },
        { key: "reason", label: "Reason", render: (r) => <span className="text-xs">{r.reason || "—"}</span> },
        { key: "evidence_ref", label: "Evidence", mono: true }]} />
    </>
  );
}
