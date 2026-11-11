import { PageHeader, StatusBadge } from "../components/kit";
import { ListTable } from "../components/ListPage";
import { CITIES } from "../lib/format";

export default function Vehicles() {
  return (
    <>
      <PageHeader title="Vehicles" subtitle="Fleet mirror from MyVolt. Vehicle–driver assignment is validated on every payment request." />
      <ListTable endpoint="/admin/vehicles" testid="vehicles-table"
        filters={[{ key: "city", label: "Cities", options: CITIES }, { key: "status", label: "Statuses", options: ["ACTIVE", "INACTIVE"] }]}
        columns={[
          { key: "registration_no", label: "Registration", mono: true }, { key: "id", label: "Vehicle ID", mono: true },
          { key: "model", label: "Model" }, { key: "city", label: "City" }, { key: "state", label: "State" },
          { key: "driver_name", label: "Assigned driver" }, { key: "source", label: "Source", render: (r) => <span className="text-xs">{r.source}</span> },
          { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> }]} />
    </>
  );
}
