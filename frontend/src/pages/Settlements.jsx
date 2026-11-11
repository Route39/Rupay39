import { PageHeader, StatusBadge } from "../components/kit";
import { ListTable } from "../components/ListPage";
import { inr, dt } from "../lib/format";

export default function Settlements() {
  return (
    <>
      <PageHeader title="Settlements" subtitle="Consolidated bank settlement credits, compared with the sum of individually bank-matched credits for the prior 24h. Never treated as a single driver payment." />
      <ListTable endpoint="/settlements" testid="settlements-table" search={false}
        filters={[{ key: "status", label: "Statuses", options: ["UNRECONCILED", "RECONCILED", "DISCREPANCY"] }]}
        columns={[
          { key: "settlement_time", label: "Credited", render: (r) => <span className="text-xs">{dt(r.settlement_time)}</span> },
          { key: "reference", label: "Reference", mono: true }, { key: "description", label: "Narration", render: (r) => <span className="text-xs">{r.description}</span> },
          { key: "transaction_count", label: "Matched txns", align: "right" },
          { key: "expected_amount", label: "Expected", align: "right", render: (r) => inr(r.expected_amount) },
          { key: "amount", label: "Credited", align: "right", render: (r) => inr(r.amount) },
          { key: "difference", label: "Difference", align: "right", render: (r) => <span className={r.difference ? "text-red-600" : ""}>{inr(r.difference)}</span> },
          { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> }]} />
    </>
  );
}
