import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { PageHeader, StatusBadge, Field } from "../components/kit";
import { ListTable } from "../components/ListPage";
import { DataTable } from "../components/DataTable";
import { Button } from "../components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../components/ui/sheet";
import { useFetch } from "../lib/api";
import { inr, dt, CITIES } from "../lib/format";
import { useMe } from "../context/MeContext";
import { CreateRequestDialog, reqColumns } from "./PaymentRequests";

function DriverSheet({ id, onClose }) {
  const nav = useNavigate();
  const { isFinance } = useMe();
  const [open, setOpen] = useState(false);
  const { data } = useFetch(id ? `/admin/drivers/${id}` : null);
  const d = data?.driver;
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto bg-white sm:max-w-2xl" data-testid="driver-sheet">
        {d && (<>
          <SheetHeader><SheetTitle>{d.name} <span className="font-mono text-sm text-slate-400">{d.id}</span></SheetTitle></SheetHeader>
          <div className="mt-4 grid grid-cols-3 gap-4">
            <Field k="Vehicle" v={d.vehicle_reg} mono /><Field k="City" v={d.city} /><Field k="Source" v={d.source} />
            <Field k="Daily rent" v={inr(d.daily_rent)} mono /><Field k="Outstanding" v={inr(d.outstanding_amount)} mono />
            <Field k="Payable now" v={<b>{inr(data.payable.total_payable)}</b>} mono />
          </div>
          {isFinance && <Button className="mt-4 bg-[#B9F36B] text-[#111827] hover:bg-[#a3e635]" disabled={!data.payable.total_payable} onClick={() => setOpen(true)} data-testid="driver-create-request-btn"><Plus className="mr-1 h-4 w-4" />{data.payable.total_payable ? "Create payment request" : "Nothing payable now"}</Button>}
          <h4 className="mb-2 mt-6 text-sm font-semibold">Recent payment requests</h4>
          <DataTable columns={reqColumns.filter((c) => c.key !== "driver_name")} rows={data.requests} onRowClick={(r) => nav(`/requests/${r.id}`)} testid="driver-requests-table" />
          <CreateRequestDialog open={open} onOpenChange={setOpen} driverId={d.id} onCreated={(r) => nav(`/requests/${r.id}`)} />
        </>)}
      </SheetContent>
    </Sheet>
  );
}

export default function Drivers() {
  const [sel, setSel] = useState(null);
  return (
    <>
      <PageHeader title="Drivers" subtitle="Read-only mirror of MyVolt driver & rental data. MyVolt remains authoritative for rental rules." />
      <ListTable endpoint="/admin/drivers" testid="drivers-table" onRowClick={(r) => setSel(r.id)}
        filters={[{ key: "city", label: "Cities", options: CITIES }, { key: "status", label: "Statuses", options: ["ACTIVE", "INACTIVE"] }]}
        columns={[
          { key: "id", label: "Driver ID", mono: true }, { key: "name", label: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "vehicle_reg", label: "Vehicle", mono: true }, { key: "city", label: "City" },
          { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
          { key: "last_payment_at", label: "Last payment", render: (r) => <span className="text-xs">{dt(r.last_payment_at)}</span> },
          { key: "daily_rent", label: "Daily rent", align: "right", render: (r) => inr(r.daily_rent) },
          { key: "outstanding_amount", label: "Outstanding", align: "right", render: (r) => inr(r.outstanding_amount) },
          { key: "payable", label: "Payable now", align: "right", render: (r) => <b>{inr(r.payable?.total_payable)}</b> }]} />
      <DriverSheet id={sel} onClose={() => setSel(null)} />
    </>
  );
}
