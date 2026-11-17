import React, { useState } from "react";
import { toast } from "sonner";
import { 
  Copy, 
  ExternalLink, 
  KeyRound, 
  RotateCcw, 
  Code2, 
  Play, 
  Terminal, 
  Check, 
  Layers, 
  ShieldCheck, 
  Zap, 
  Smartphone,
  BookOpen
} from "lucide-react";
import { PageHeader, StatusBadge, Card, FilterSelect } from "../components/kit";
import { ListTable } from "../components/ListPage";
import { DataTable } from "../components/DataTable";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { useApi, useFetch, errMsg, API } from "../lib/api";
import { dt, label } from "../lib/format";
import { useMe } from "../context/MeContext";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || (typeof window !== "undefined" && window.location.hostname === "localhost" ? "http://localhost:8010" : "");
const DEFAULT_TEST_KEY = "r39_ev_rent_g_ut-3KCGV4aRDvgz4jHaQW6_h0SRN9Po85RxXeHlO8";

// Interactive API Playground
function ApiPlayground() {
  const [selectedEndpoint, setSelectedEndpoint] = useState("create_payment");
  const [apiKey, setApiKey] = useState(DEFAULT_TEST_KEY);
  const [executing, setExecuting] = useState(false);
  const [response, setResponse] = useState(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [activeCodeTab, setActiveCodeTab] = useState("curl");

  const endpoints = {
    create_payment: {
      name: "Create Payment (EV Rent / Driver App)",
      method: "POST",
      path: "/api/v1/payments/create",
      description: "Creates an authoritative payment request and dynamic hosted checkout URL for a driver.",
      body: JSON.stringify({ driver_id: "DRV-0001", vehicle_id: "VEH-0001", provider: "MOCK" }, null, 2),
    },
    checkout_order: {
      name: "Create Dynamic Checkout Order",
      method: "POST",
      path: "/api/checkout/orders",
      description: "Generates an instant dynamic UPI checkout order with deep links for Google Pay, PhonePe, and Paytm.",
      body: JSON.stringify({ amount: 450.00, purpose: "Route39 EV Fleet Rent", customer_name: "Ramesh Kumar", customer_phone: "+919876543210" }, null, 2),
    },
    driver_outstanding: {
      name: "Get Driver Outstanding Balance",
      method: "GET",
      path: "/api/v1/drivers/DRV-0001/outstanding",
      description: "Fetches rental balance due and total payable for a driver before requesting payment.",
      body: "",
    },
    poll_status: {
      name: "Poll Payment Status",
      method: "GET",
      path: "/api/checkout/orders/ord_r39_2ce7d31298dd",
      description: "Checks real-time bank verification status and retrieves receipt number upon completion.",
      body: "",
    },
  };

  const curr = endpoints[selectedEndpoint];

  const runTestRequest = async () => {
    setExecuting(true);
    setResponse(null);
    const start = performance.now();
    try {
      const url = `${BACKEND_URL}${curr.path}`;
      const headers = {
        "Content-Type": "application/json",
      };
      if (apiKey) headers["X-API-Key"] = apiKey;

      const opts = {
        method: curr.method,
        headers,
      };
      if (curr.method === "POST" && curr.body) {
        opts.body = curr.body;
      }

      const res = await fetch(url, opts);
      const data = await res.json().catch(() => ({}));
      const duration = Math.round(performance.now() - start);

      setResponse({
        status: res.status,
        statusText: res.statusText,
        duration: `${duration}ms`,
        data,
      });
      if (res.ok) {
        toast.success(`HTTP ${res.status} OK (${duration}ms)`);
      } else {
        toast.error(`HTTP ${res.status} Error`);
      }
    } catch (err) {
      setResponse({
        status: 0,
        statusText: "Network Error",
        duration: "0ms",
        data: { error: err.message },
      });
      toast.error(err.message);
    } finally {
      setExecuting(false);
    }
  };

  // Generate code snippet based on active tab
  const getCodeSnippet = () => {
    const fullUrl = `${BACKEND_URL}${curr.path}`;
    if (activeCodeTab === "curl") {
      if (curr.method === "POST") {
        return `curl -X POST "${fullUrl}" \\
  -H "X-API-Key: ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '${curr.body.replace(/\n/g, "")}'`;
      }
      return `curl -X GET "${fullUrl}" \\
  -H "X-API-Key: ${apiKey}"`;
    }

    if (activeCodeTab === "node") {
      if (curr.method === "POST") {
        return `const axios = require('axios');

async function execute() {
  const { data } = await axios.post('${fullUrl}', ${curr.body}, {
    headers: {
      'X-API-Key': '${apiKey}',
      'Content-Type': 'application/json'
    }
  });
  console.log('Result:', data);
}
execute();`;
      }
      return `const axios = require('axios');

async function execute() {
  const { data } = await axios.get('${fullUrl}', {
    headers: { 'X-API-Key': '${apiKey}' }
  });
  console.log('Result:', data);
}
execute();`;
    }

    if (activeCodeTab === "python") {
      if (curr.method === "POST") {
        return `import requests

url = "${fullUrl}"
headers = {
    "X-API-Key": "${apiKey}",
    "Content-Type": "application/json"
}
payload = ${curr.body}

response = requests.post(url, json=payload, headers=headers)
print("Status:", response.status_code)
print("Response:", response.json())`;
      }
      return `import requests

url = "${fullUrl}"
headers = { "X-API-Key": "${apiKey}" }

response = requests.get(url, headers=headers)
print("Status:", response.status_code)
print("Response:", response.json())`;
    }

    if (activeCodeTab === "flutter") {
      return `import 'package:http/http.dart' as http;
import 'dart:convert';

Future<void> makePayment() async {
  final url = Uri.parse('${fullUrl}');
  final response = await http.${curr.method.toLowerCase()}(
    url,
    headers: {
      'X-API-Key': '${apiKey}',
      'Content-Type': 'application/json',
    },
    ${curr.method === "POST" ? `body: jsonEncode(${curr.body}),` : ""}
  );

  final data = jsonDecode(response.body);
  print('Rupay39 Response: $data');
}`;
    }

    return "";
  };

  const copyCode = () => {
    navigator.clipboard.writeText(getCodeSnippet());
    setCopiedCode(true);
    toast.success("Code snippet copied to clipboard!");
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <Card 
      title={
        <div className="flex items-center justify-between w-full">
          <span className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-[#B9F36B]" /> Interactive API Tester & Live Sandbox
          </span>
          <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
            Live Gateway Ready
          </span>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Endpoint Selector Bar */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          {Object.entries(endpoints).map(([key, ep]) => (
            <button
              key={key}
              onClick={() => {
                setSelectedEndpoint(key);
                setResponse(null);
              }}
              className={`rounded-xl border p-2.5 text-left transition ${
                selectedEndpoint === key
                  ? "border-[#B9F36B] bg-[#111827] text-white shadow-md"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <div className="flex items-center gap-1.5 font-mono text-[10px] font-bold">
                <span className={`px-1.5 py-0.5 rounded text-[9px] ${ep.method === "POST" ? "bg-blue-600 text-white" : "bg-emerald-600 text-white"}`}>
                  {ep.method}
                </span>
                <span className="truncate">{ep.path}</span>
              </div>
              <div className="mt-1 text-xs font-semibold truncate">{ep.name}</div>
            </button>
          ))}
        </div>

        <p className="text-xs text-slate-500">{curr.description}</p>

        {/* API Key Input and Send Button */}
        <div className="flex flex-col sm:flex-row items-center gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
          <div className="flex items-center gap-2 flex-1 w-full">
            <span className="font-mono text-[11px] font-semibold text-slate-500 whitespace-nowrap">X-API-Key:</span>
            <Input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste X-API-Key here"
              className="h-8 font-mono text-xs bg-white"
            />
          </div>
          <Button
            onClick={runTestRequest}
            disabled={executing}
            className="w-full sm:w-auto h-8 bg-[#B9F36B] text-[#0B0F19] hover:bg-[#a3e635] font-bold text-xs flex items-center gap-1.5 shadow"
          >
            <Play className={`h-3.5 w-3.5 ${executing ? "animate-spin" : "fill-current"}`} />
            {executing ? "Testing..." : "Send Test Request"}
          </Button>
        </div>

        {/* Code Snippets & Response Split View */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-1">
          {/* Left: Code Snippet */}
          <div className="rounded-xl border border-slate-200 bg-[#0F172A] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 bg-black/30">
              <div className="flex items-center gap-1.5">
                {[
                  { id: "curl", label: "cURL" },
                  { id: "node", label: "Node.js" },
                  { id: "python", label: "Python" },
                  { id: "flutter", label: "Flutter" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveCodeTab(tab.id)}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold transition ${
                      activeCodeTab === tab.id
                        ? "bg-[#B9F36B] text-[#0F172A]"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <button
                onClick={copyCode}
                className="flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-white/20 transition"
              >
                {copiedCode ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                {copiedCode ? "Copied" : "Copy Code"}
              </button>
            </div>
            <pre className="p-3 font-mono text-[11px] leading-relaxed text-[#B9F36B] overflow-x-auto flex-1">
              {getCodeSnippet()}
            </pre>
          </div>

          {/* Right: Live Response */}
          <div className="rounded-xl border border-slate-200 bg-[#0F172A] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 bg-black/30">
              <span className="font-mono text-[11px] font-bold text-slate-300">Live API Response</span>
              {response && (
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${response.status === 200 ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"}`}>
                    {response.status} {response.statusText}
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">{response.duration}</span>
                </div>
              )}
            </div>
            <pre className="p-3 font-mono text-[11px] leading-relaxed text-slate-200 overflow-x-auto flex-1">
              {response ? (
                JSON.stringify(response.data, null, 2)
              ) : (
                <span className="text-slate-500 italic">Click "Send Test Request" above to execute this live API call against the backend...</span>
              )}
            </pre>
          </div>
        </div>
      </div>
    </Card>
  );
}

function ApiClients() {
  const api = useApi();
  const { data, reload } = useFetch("/api-clients");
  const [name, setName] = useState("");
  const [system, setSystem] = useState("EV_RENT");
  const [key, setKey] = useState(null);

  const create = async () => {
    try { 
      const r = await api.post("/api-clients", { name, system }); 
      setKey(r.data.api_key); 
      setName(""); 
      reload(); 
    } catch (e) { 
      toast.error(errMsg(e)); 
    }
  };

  const revoke = async (id) => { 
    try { 
      await api.post(`/api-clients/${id}/revoke`); 
      reload(); 
    } catch (e) { 
      toast.error(errMsg(e)); 
    } 
  };

  return (
    <Card title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4" />Service API keys</span>} testid="api-clients-card">
      <div className="mb-4 flex flex-wrap gap-2">
        <Input 
          placeholder="Client name (e.g. EV Rent backend)" 
          value={name} 
          onChange={(e) => setName(e.target.value)} 
          className="h-9 w-64" 
          data-testid="api-client-name-input" 
        />
        <FilterSelect 
          value={system} 
          onChange={(v) => setSystem(v === "ALL" ? "EV_RENT" : v)} 
          options={["EV_RENT", "MYVOLT", "OTHER"]} 
          allLabel="System" 
          testid="api-client-system-select" 
        />
        <Button onClick={create} disabled={name.length < 2} className="bg-[#111827]" data-testid="api-client-create-btn">
          Issue key
        </Button>
      </div>
      {key && (
        <div className="mb-4 rounded-lg border border-[#B9F36B] bg-[#B9F36B]/15 p-3 text-xs" data-testid="api-key-reveal">
          <b>Copy now — shown only once.</b> Send it as header <code>X-API-Key</code> from the EV Rent backend (never from the mobile app).
          <div className="mt-2 flex items-center gap-2">
            <code className="break-all font-mono font-bold text-slate-900">{key}</code>
            <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(key); toast.success("Copied"); }} data-testid="api-key-copy-btn">
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
      <DataTable 
        testid="api-clients-table" 
        rows={data} 
        columns={[
          { key: "name", label: "Name" }, 
          { key: "system", label: "System" }, 
          { key: "key_prefix", label: "Key prefix", mono: true },
          { key: "active", label: "Status", render: (r) => <StatusBadge status={r.active ? "ACTIVE" : "INACTIVE"} /> },
          { key: "last_used_at", label: "Last used", render: (r) => <span className="text-xs">{dt(r.last_used_at)}</span> },
          { key: "x", label: "", render: (r) => r.active && <Button size="sm" variant="outline" onClick={() => revoke(r.id)} data-testid={`api-client-revoke-${r.id}`}>Revoke</Button> }
        ]} 
      />
    </Card>
  );
}

function SyncLogs({ target }) {
  const api = useApi();
  const [rk, setRk] = useState(0);
  const retry = async (id) => { 
    try { 
      await api.post(`/sync-logs/${target}/${id}/retry`); 
      toast.success("Queued for retry"); 
      setRk((x) => x + 1); 
    } catch (e) { 
      toast.error(errMsg(e)); 
    } 
  };

  return (
    <ListTable endpoint={`/sync-logs/${target}`} testid={`sync-${target}-table`} search={false} reloadKey={rk}
      filters={[{ key: "status", label: "Statuses", options: ["SYNC_PENDING", "SYNCED", "RETRY_PENDING", "SYNC_FAILED"] }]}
      columns={[
        { key: "created_at", label: "Queued", render: (r) => <span className="text-xs">{dt(r.created_at)}</span> },
        { key: "event_type", label: "Event", mono: true }, { key: "payment_id", label: "Payment", mono: true },
        { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> }, { key: "attempts", label: "Attempts" },
        { key: "last_error", label: "Last error", render: (r) => <span className="text-xs text-red-600">{r.last_error || "—"}</span> },
        { key: "response", label: "Response", render: (r) => <span className="text-[11px] text-slate-500">{r.response?.simulated ? "MOCK ack" : r.response ? "OK" : "—"}</span> },
        { key: "x", label: "", render: (r) => ["SYNC_FAILED", "RETRY_PENDING"].includes(r.status) && <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); retry(r.id); }} data-testid={`sync-retry-${r.id}`}><RotateCcw className="h-3.5 w-3.5" /></Button> }
      ]} 
    />
  );
}

export default function Integrations() {
  const { isSuper } = useMe();

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Developer & API Integrations" 
        subtitle="Connect Driver Apps, EV Rent partner systems, and web checkouts. Authenticated service APIs with instant bank settlement."
      >
        <a href={`${BACKEND_URL}/api/docs`} target="_blank" rel="noreferrer">
          <Button variant="outline" size="sm" data-testid="open-api-docs-btn">
            <ExternalLink className="mr-1.5 h-4 w-4" />OpenAPI / Swagger Specs
          </Button>
        </a>
      </PageHeader>

      {/* Interactive Live API Tester (For Developers) */}
      <ApiPlayground />

      {/* Service API Keys Management */}
      {isSuper && <ApiClients />}

      {/* Cross-System Specifications */}
      <div className="grid gap-4 lg:grid-cols-3">
        {[
          ["EV Rent & Driver Apps → RUPAY39", "POST /api/v1/payments/create · GET /api/v1/payments/{id} · /receipt · /instructions · POST /utr · /dispute · GET /api/v1/drivers/{id}/payments · /outstanding"],
          ["RUPAY39 → MyVolt ERP Outbox", "Verified payment events via outbox with Idempotency-Key. Set MYVOLT_PAYMENT_SYNC_URL + MYVOLT_API_KEY once MyVolt shares its endpoint."],
          ["Bank / Provider → RUPAY39 Webhooks", "POST /api/webhooks/{PROVIDER}. Signature verified before any processing; duplicate callbacks are rejected idempotently by event ID."]
        ].map(([t, d]) => (
          <Card key={t} title={t}>
            <p className="font-mono text-[11px] leading-relaxed text-slate-600">{d}</p>
          </Card>
        ))}
      </div>

      {/* Outbox & Callback Logs */}
      <Tabs defaultValue="myvolt" className="space-y-3">
        <TabsList className="bg-white">
          <TabsTrigger value="myvolt" data-testid="tab-myvolt-sync">MyVolt sync</TabsTrigger>
          <TabsTrigger value="evrent" data-testid="tab-evrent-sync">EV Rent notifications</TabsTrigger>
          <TabsTrigger value="hooks" data-testid="tab-webhook-log">Provider callbacks</TabsTrigger>
        </TabsList>
        <TabsContent value="myvolt"><SyncLogs target="myvolt" /></TabsContent>
        <TabsContent value="evrent"><SyncLogs target="evrent" /></TabsContent>
        <TabsContent value="hooks">
          <ListTable 
            endpoint="/webhooks" 
            testid="webhooks-table" 
            search={false} 
            columns={[
              { key: "received_at", label: "Received", render: (r) => <span className="text-xs">{dt(r.received_at)}</span> },
              { key: "provider", label: "Provider" }, 
              { key: "event_key", label: "Event", mono: true },
              { key: "signature_valid", label: "Signature", render: (r) => <StatusBadge status={r.signature_valid ? "MATCHED" : "FAILED"} /> },
              { key: "result", label: "Result", render: (r) => <span className="text-xs">{label(r.result)}</span> }, 
              { key: "duplicate_count", label: "Dupes ignored" }
            ]} 
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
