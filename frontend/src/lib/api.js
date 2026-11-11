import axios from "axios";
import { useAuth } from "@clerk/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export function useApi() {
  const { getToken } = useAuth();
  return useMemo(() => {
    const inst = axios.create({ baseURL: API });
    inst.interceptors.request.use(async (cfg) => {
      const t = await getToken();
      if (t) cfg.headers.Authorization = `Bearer ${t}`;
      return cfg;
    });
    return inst;
  }, [getToken]);
}

const clean = (p) => Object.fromEntries(Object.entries(p || {}).filter(([, v]) => v !== "" && v !== null && v !== undefined && v !== "ALL"));

export function useFetch(path, params) {
  const api = useApi();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const key = JSON.stringify(params || {});
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const r = await api.get(path, { params: clean(JSON.parse(key)) });
      if (mine !== seq.current) return;
      setData(r.data);
      setError(null);
    } catch (e) {
      if (mine === seq.current) setError(errMsg(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [api, path, key]);
  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export function errMsg(e) {
  const d = e?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x.msg).join("; ");
  return e?.message || "Something went wrong";
}

export async function download(api, path, params, filename) {
  const r = await api.get(path, { params: clean(params), responseType: "blob" });
  const url = URL.createObjectURL(r.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
