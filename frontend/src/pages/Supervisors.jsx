import { toast } from "sonner";
import { PageHeader, StatusBadge, FilterSelect } from "../components/kit";
import { DataTable } from "../components/DataTable";
import { Switch } from "../components/ui/switch";
import { Checkbox } from "../components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Button } from "../components/ui/button";
import { useApi, useFetch, errMsg } from "../lib/api";
import { dt } from "../lib/format";

export default function Supervisors() {
  const api = useApi();
  const { data, reload } = useFetch("/users");
  const update = async (uid, body) => {
    try { await api.patch(`/users/${uid}`, body); toast.success("User updated"); reload(); } catch (e) { toast.error(errMsg(e)); }
  };
  const roles = data?.roles || [];
  return (
    <>
      <PageHeader title="Supervisors & users" subtitle="People sign up themselves and start as Pending (no access). Assign a role and, for supervisors, their cities." />
      <DataTable testid="users-table" rowKey="user_id" rows={data?.users} columns={[
        { key: "name", label: "Name", render: (u) => <div><div className="font-medium">{u.name}</div><div className="text-[11px] text-slate-400">{u.email}</div></div> },
        { key: "role", label: "Role", render: (u) => (
          <FilterSelect value={u.role} onChange={(v) => v !== "ALL" && update(u.user_id, { role: v })} options={roles.map((r) => ({ value: r.code, label: r.label }))} allLabel="Role" testid={`user-role-${u.user_id}`} />) },
        { key: "cities", label: "Cities (supervisor scope)", render: (u) => (
          <Popover>
            <PopoverTrigger asChild><Button variant="outline" size="sm" className="max-w-[220px] truncate" data-testid={`user-cities-${u.user_id}`}>{u.cities?.length ? u.cities.join(", ") : "None"}</Button></PopoverTrigger>
            <PopoverContent className="w-52 space-y-2 bg-white">
              {(data?.cities || []).map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={u.cities?.includes(c)} onCheckedChange={(on) => update(u.user_id, { cities: on ? [...(u.cities || []), c] : u.cities.filter((x) => x !== c) })} data-testid={`user-city-${u.user_id}-${c}`} />{c}
                </label>))}
            </PopoverContent>
          </Popover>) },
        { key: "active", label: "Active", render: (u) => <Switch checked={u.active !== false} onCheckedChange={(v) => update(u.user_id, { active: v })} data-testid={`user-active-${u.user_id}`} /> },
        { key: "env", label: "Env", render: (u) => <StatusBadge status={(u.env || "preview").toUpperCase()} /> },
        { key: "created_at", label: "Joined", render: (u) => <span className="text-xs">{dt(u.created_at)}</span> },
      ]} />
    </>
  );
}
