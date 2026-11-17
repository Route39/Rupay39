import { createContext, useContext, useEffect, useState, useCallback } from "react";
import axios from "axios";
import { API, getAuthToken, setAuthToken, errMsg } from "../lib/api";

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
  const [token, setToken] = useState(() => getAuthToken());
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(Boolean(getAuthToken()));
  const [error, setError] = useState(null);
  const brand = useBranding();

  const loadProfile = useCallback(async (currToken) => {
    const t = currToken || getAuthToken();
    if (!t) {
      setMe(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await axios.get(`${API}/admin/me`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      setMe(res.data);
      setError(null);
    } catch (err) {
      if (err?.response?.status === 401 || err?.response?.status === 403) {
        setAuthToken(null);
        setToken("");
        setMe(null);
      }
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) {
      loadProfile(token);
    } else {
      setMe(null);
      setLoading(false);
    }
  }, [token, loadProfile]);

  const login = useCallback(async (email, password) => {
    const res = await axios.post(`${API}/auth/login`, { email, password });
    const { token: newToken, user } = res.data;
    setAuthToken(newToken);
    setToken(newToken);
    setMe(user);
    // Reload full me profile with permissions
    await loadProfile(newToken);
    return user;
  }, [loadProfile]);

  const register = useCallback(async ({ name, email, password, cities }) => {
    const res = await axios.post(`${API}/auth/register`, { name, email, password, cities });
    const { token: newToken, user } = res.data;
    setAuthToken(newToken);
    setToken(newToken);
    setMe(user);
    await loadProfile(newToken);
    return user;
  }, [loadProfile]);

  const logout = useCallback(() => {
    setAuthToken(null);
    setToken("");
    setMe(null);
    setError(null);
  }, []);

  const role = me?.role;
  const value = {
    token,
    me,
    loading,
    error,
    reload: () => loadProfile(token),
    brand,
    role,
    login,
    register,
    logout,
    isSuper: role === "admin",
    isFinance: role === "admin" || role === "finance_admin",
    isStaff: ["admin", "finance_admin", "supervisor"].includes(role),
  };

  return <MeCtx.Provider value={value}>{children}</MeCtx.Provider>;
}
