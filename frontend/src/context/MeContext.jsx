import { createContext, useContext, useEffect, useState } from "react";
import axios from "axios";
import { useFetch, API } from "../lib/api";

const MeCtx = createContext(null);
export const useMe = () => useContext(MeCtx);

export function useBranding() {
  const [b, setB] = useState({ brand_name: "RUPAY39", brand_tagline: "POWERED BY ROUTE39", logo_url: "" });
  useEffect(() => {
    axios.get(`${API}/public/branding`).then((r) => setB(r.data)).catch(() => {});
  }, []);
  return b;
}

export function MeProvider({ children }) {
  const { data, loading, error, reload } = useFetch("/admin/me");
  const brand = useBranding();
  const role = data?.role;
  const value = {
    me: data, loading, error, reload, brand, role,
    isSuper: role === "admin",
    isFinance: role === "admin" || role === "finance_admin",
    isStaff: ["admin", "finance_admin", "supervisor"].includes(role),
  };
  return <MeCtx.Provider value={value}>{children}</MeCtx.Provider>;
}
