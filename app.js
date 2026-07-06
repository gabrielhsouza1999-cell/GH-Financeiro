const STORAGE_KEY = "gh-financeiro-state-v1";
const ACCESS_KEY = "gh-financeiro-access-mode";
const AUTH_KEY = "gh-financeiro-supabase-auth";

const categories = [
  "Estoque",
  "Operação",
  "Funcionários",
  "Impostos",
  "Dívidas",
  "Retirada pessoal",
  "Consumo próprio",
  "Outros",
];

const tabs = [
  ["dashboard", "Dashboard"],
  ["config", "Configuração"],
  ["sales", "Vendas"],
  ["expenses", "Despesas"],
  ["payables", "Contas a pagar"],
  ["debts", "Dívidas antigas"],
  ["withdrawals", "Retiradas"],
  ["consumption", "Consumo próprio"],
  ["stock", "Compras estoque"],
  ["action", "Plano de ação"],
  ["history", "Histórico mensal"],
];

const blank = {
  config: {
    company: "GH Financeiro",
    owner: "",
    month: new Date().toISOString().slice(0, 7),
    cashInitial: 0,
    bankInitial: 0,
    investmentsInitial: 0,
    stockInitial: 0,
    managerPin: "1234",
    feePix: 0,
    feeDebit: 0,
    feeCredit: 0,
  },
  sales: [],
  expenses: [],
  payables: [],
  debts: [],
  withdrawals: [],
  consumption: [],
  stock: [],
  actionPlan: [],
  monthlySnapshots: [],
  previousMonthCashFree: 0,
};

let state = loadState();
let activeTab = "dashboard";
const urlMode = new URLSearchParams(window.location.search).get("modo") || window.location.hash.replace("#", "");
let accessMode = urlMode === "gestor" || urlMode === "manager" ? "manager" : "operator";
let operatorNotice = "";
let cloudNotice = "";

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
}

function loadState() {
  try {
    return { ...structuredClone(blank), ...(JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}) };
  } catch {
    return structuredClone(blank);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function setAccessMode(mode) {
  if (mode === "manager") {
    if (supabaseReady() && !authToken()) {
      managerLogin();
      return;
    }
    if (!supabaseReady()) {
      const pin = prompt("Digite o PIN do gestor");
      if (pin !== String(state.config.managerPin || "1234")) {
        alert("PIN incorreto.");
        return;
      }
    }
  }
  accessMode = mode;
  sessionStorage.setItem(ACCESS_KEY, mode);
  activeTab = "dashboard";
  render();
}

function supabaseConfig() {
  return window.GH_SUPABASE || {};
}

function supabaseReady() {
  const cfg = supabaseConfig();
  return Boolean(cfg.url && cfg.anonKey);
}

function authToken() {
  try {
    return JSON.parse(sessionStorage.getItem(AUTH_KEY) || "null")?.access_token || "";
  } catch {
    return "";
  }
}

function supabaseHeaders(useAuth = false) {
  const cfg = supabaseConfig();
  return {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${useAuth && authToken() ? authToken() : cfg.anonKey}`,
    "Content-Type": "application/json",
  };
}

async function supabaseFetch(path, options = {}, useAuth = false) {
  if (!supabaseReady()) throw new Error("Supabase não configurado.");
  const cfg = supabaseConfig();
  const response = await fetch(`${cfg.url}${path}`, {
    ...options,
    headers: { ...supabaseHeaders(useAuth), ...(options.headers || {}) },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Erro Supabase ${response.status}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function managerLogin() {
  if (!supabaseReady()) {
    alert("Configure o Supabase no arquivo supabase-config.js.");
    return;
  }
  const email = prompt("E-mail do gestor no Supabase");
  if (!email) return;
  const password = prompt("Senha do gestor");
  if (!password) return;
  try {
    const cfg = supabaseConfig();
    const response = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: supabaseHeaders(false),
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) throw new Error(await response.text());
    const auth = await response.json();
    sessionStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    accessMode = "manager";
    sessionStorage.setItem(ACCESS_KEY, "manager");
    await loadRemoteState();
    cloudNotice = "Gestor conectado ao Supabase.";
    render();
  } catch (error) {
    alert(`Não foi possível entrar: ${error.message}`);
  }
}

function managerLogout() {
  sessionStorage.removeItem(AUTH_KEY);
  cloudNotice = "Gestor desconectado.";
  render();
}

async function loadRemoteState() {
  if (!supabaseReady() || !authToken()) return;
  const settings = await supabaseFetch("/rest/v1/gh_settings?id=eq.default&select=data", { method: "GET" }, true);
  const entries = await supabaseFetch("/rest/v1/gh_entries?select=id,collection,payload&order=created_at.asc", { method: "GET" }, true);
  const snapshots = await supabaseFetch("/rest/v1/gh_monthly_snapshots?select=id,month,company,summary,state,created_at&order=month.desc", { method: "GET" }, true);
  const next = structuredClone(blank);
  const data = settings?.[0]?.data || {};
  next.config = { ...next.config, ...(data.config || {}) };
  next.previousMonthCashFree = data.previousMonthCashFree || 0;
  (entries || []).forEach((entry) => {
    if (Array.isArray(next[entry.collection])) {
      next[entry.collection].push({ id: entry.id, ...(entry.payload || {}) });
    }
  });
  next.monthlySnapshots = snapshots || [];
  state = next;
  saveState();
}

async function saveRemoteSettings() {
  if (!supabaseReady() || !authToken()) return;
  await supabaseFetch("/rest/v1/gh_settings?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      id: "default",
      data: {
        config: state.config,
        previousMonthCashFree: state.previousMonthCashFree,
      },
    }),
  }, true);
}

async function insertRemoteEntry(collection, row, useAuth = Boolean(authToken())) {
  if (!supabaseReady()) return;
  const { id, ...payload } = row;
  await supabaseFetch("/rest/v1/gh_entries?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ id, collection, payload }),
  }, useAuth);
}

async function syncLocalEntriesAsOperator() {
  if (!supabaseReady()) {
    operatorNotice = "Supabase ainda não configurado. Os dados continuam salvos apenas neste aparelho.";
    render();
    return;
  }
  const collections = ["sales", "expenses", "payables", "debts", "withdrawals", "consumption", "stock", "actionPlan"];
  let sent = 0;
  try {
    for (const collection of collections) {
      for (const row of state[collection] || []) {
        await insertRemoteEntry(collection, row, false);
        sent += 1;
      }
    }
    operatorNotice = sent
      ? `Dados salvos neste aparelho reenviados para a nuvem: ${sent} lançamento(s).`
      : "Não há lançamentos locais para reenviar.";
  } catch (error) {
    operatorNotice = `Não foi possível reenviar os dados: ${error.message}`;
  }
  render();
}

async function updateRemoteEntry(collection, row) {
  if (!supabaseReady() || !authToken()) return;
  const { id, ...payload } = row;
  await supabaseFetch(`/rest/v1/gh_entries?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ collection, payload, updated_at: new Date().toISOString() }),
  }, true);
}

async function deleteRemoteEntry(id) {
  if (!supabaseReady() || !authToken()) return;
  await supabaseFetch(`/rest/v1/gh_entries?id=eq.${id}`, { method: "DELETE" }, true);
}

async function insertRemoteSnapshot(snapshot) {
  if (!supabaseReady() || !authToken()) return;
  await supabaseFetch("/rest/v1/gh_monthly_snapshots?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(snapshot),
  }, true);
}

async function clearRemoteEntries() {
  if (!supabaseReady() || !authToken()) return;
  await supabaseFetch("/rest/v1/gh_entries?id=not.is.null", { method: "DELETE" }, true);
}

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pct(value) {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function num(value) {
  return Number(value || 0);
}

function monthDays() {
  const [year, month] = state.config.month.split("-").map(Number);
  return new Date(year || new Date().getFullYear(), month || new Date().getMonth() + 1, 0).getDate();
}

function saleTotal(row) {
  return num(row.cash) + num(row.pix) + num(row.debit) + num(row.credit);
}

function saleFees(row) {
  return {
    pix: num(row.pix) * ratioDecimal(state.config.feePix),
    debit: num(row.debit) * ratioDecimal(state.config.feeDebit),
    credit: num(row.credit) * ratioDecimal(state.config.feeCredit),
  };
}

function saleFeeTotal(row) {
  const fees = saleFees(row);
  return fees.pix + fees.debit + fees.credit;
}

function saleNetTotal(row) {
  return saleTotal(row) - saleFeeTotal(row);
}

function ratioDecimal(value) {
  return num(value) / 100;
}

function metrics() {
  const grossRevenue = state.sales.reduce((sum, row) => sum + saleTotal(row), 0);
  const bankFees = state.sales.reduce((sum, row) => sum + saleFeeTotal(row), 0);
  const revenue = grossRevenue - bankFees;
  const cashSales = state.sales.reduce((sum, row) => sum + num(row.cash), 0);
  const bankSales = state.sales.reduce((sum, row) => {
    const fees = saleFees(row);
    return sum + num(row.pix) - fees.pix + num(row.debit) - fees.debit + num(row.credit) - fees.credit;
  }, 0);
  const expenseTotal = state.expenses.reduce((sum, row) => sum + num(row.value), 0);
  const expenseByCategory = Object.fromEntries(categories.map((cat) => [cat, 0]));
  state.expenses.forEach((row) => {
    expenseByCategory[row.category] = num(expenseByCategory[row.category]) + num(row.value);
  });

  const payablesPending = state.payables.filter((row) => row.status !== "Pago").reduce((sum, row) => sum + num(row.value), 0);
  const payablesPaid = state.payables.filter((row) => row.status === "Pago").reduce((sum, row) => sum + num(row.value), 0);
  const debtTotal = state.debts.reduce((sum, row) => sum + num(row.remaining), 0);
  const debtMonthly = state.debts.reduce((sum, row) => sum + num(row.installment), 0);
  const withdrawals = state.withdrawals.reduce((sum, row) => sum + num(row.value), 0) + num(expenseByCategory["Retirada pessoal"]);
  const consumption = state.consumption.reduce((sum, row) => sum + num(row.value), 0) + num(expenseByCategory["Consumo próprio"]);
  const stock = state.stock.reduce((sum, row) => sum + num(row.value), 0) + num(expenseByCategory.Estoque);
  const stockEstimated = num(state.config.stockInitial) + stock - revenue - consumption;
  const paidDebts = num(expenseByCategory["Dívidas"]) + payablesPaid;
  const operational = num(expenseByCategory.Operação);
  const exits = expenseTotal + payablesPaid + withdrawals + consumption + stock;
  const cashCurrent = num(state.config.cashInitial) + cashSales - expenseTotal - withdrawals - consumption;
  const bankCurrent = num(state.config.bankInitial) + bankSales - payablesPaid - stock - debtMonthly;
  const totalBalance = cashCurrent + bankCurrent + num(state.config.investmentsInitial);
  const cashFree = totalBalance - payablesPending;
  const workedDays = new Set(state.sales.map((row) => row.date).filter(Boolean)).size || state.sales.length || 1;
  const dailyTicket = revenue / workedDays;
  const dailyExpenses = expenseTotal / workedDays;
  const survivalDays = dailyExpenses > 0 ? cashFree / dailyExpenses : cashFree > 0 ? 999 : 0;
  const bleeding = revenue > 0 ? ((withdrawals + consumption) / revenue) * 100 : 0;

  return {
    revenue,
    grossRevenue,
    bankFees,
    cashCurrent,
    bankCurrent,
    totalBalance,
    payablesPending,
    payablesPaid,
    cashFree,
    stock,
    stockEstimated,
    withdrawals,
    consumption,
    paidDebts,
    dailyTicket,
    survivalDays,
    bleeding,
    expenseTotal,
    expenseByCategory,
    debtTotal,
    debtMonthly,
    operational,
    workedDays,
    monthlyProjection: dailyTicket * monthDays(),
    initialTotal: num(state.config.cashInitial) + num(state.config.bankInitial) + num(state.config.investmentsInitial),
    stockPct: ratio(stock, revenue),
    operationalPct: ratio(operational, revenue),
    withdrawalsPct: ratio(withdrawals, revenue),
    consumptionPct: ratio(consumption, revenue),
    debtPct: ratio(debtMonthly, revenue),
    cashFreePct: ratio(cashFree, revenue),
    exits,
  };
}

function ratio(value, total) {
  return total > 0 ? (value / total) * 100 : 0;
}

function statusFor(key, value) {
  const rules = {
    cashFree: value < 0 ? "red" : value < 1000 ? "yellow" : "green",
    bleeding: value > 10 ? "red" : value > 6 ? "yellow" : "green",
    operationalPct: value > 25 ? "red" : value > 18 ? "yellow" : "green",
    withdrawalsPct: value > 15 ? "red" : value > 10 ? "yellow" : "green",
    consumptionPct: value > 3 ? "red" : value > 1.5 ? "yellow" : "green",
    debtPct: value > 20 ? "red" : value > 10 ? "yellow" : "green",
    cashFreePct: value < 5 ? "red" : value < 15 ? "yellow" : "green",
  };
  return rules[key] || "blue";
}

function alerts(m) {
  const out = [];
  if (m.bleeding > 10) out.push(["red", "ATENÇÃO: Retiradas e consumo próprio estão comprometendo o caixa da empresa."]);
  if (m.cashFree < 0) out.push(["red", "ALERTA CRÍTICO: A empresa possui compromissos superiores ao caixa disponível."]);
  if (m.operationalPct > 25) out.push(["yellow", "ATENÇÃO: Despesas operacionais acima do recomendado."]);
  if (m.consumptionPct > 3) out.push(["yellow", "ATENÇÃO: Consumo próprio elevado."]);
  if (m.withdrawalsPct > 15) out.push(["yellow", "ATENÇÃO: Retiradas acima do limite recomendado."]);
  if (m.cashFree > num(state.previousMonthCashFree)) out.push(["green", "PARABÉNS: Sua geração de caixa melhorou em relação ao mês anterior."]);
  if (!out.length) out.push(["green", "Indicadores saudáveis para o mês em análise. Continue alimentando os dados diariamente."]);
  return out;
}

function setDeep(path, value) {
  const parts = path.split(".");
  let ref = state;
  parts.slice(0, -1).forEach((part) => (ref = ref[part]));
  ref[parts.at(-1)] = value;
  saveState();
  saveRemoteSettings().catch((error) => {
    cloudNotice = `Erro ao salvar configuração no Supabase: ${error.message}`;
    render();
  });
  render();
}

function updateRow(collection, id, key, value) {
  state[collection] = state[collection].map((row) => (row.id === id ? { ...row, [key]: value } : row));
  saveState();
  const row = state[collection].find((item) => item.id === id);
  if (row) {
    updateRemoteEntry(collection, row).catch((error) => {
      cloudNotice = `Erro ao atualizar Supabase: ${error.message}`;
      render();
    });
  }
  render();
}

function addRow(collection) {
  const today = new Date().toISOString().slice(0, 10);
  const templates = {
    sales: { date: today, cash: 0, pix: 0, debit: 0, credit: 0 },
    expenses: { date: today, category: "Operação", description: "", value: 0 },
    payables: { due: today, description: "", category: "Operação", value: 0, status: "Pendente" },
    debts: { creditor: "", total: 0, installment: 0, remaining: 0, payoff: today },
    withdrawals: { date: today, reason: "", value: 0 },
    consumption: { date: today, product: "", quantity: 1, value: 0 },
    stock: { date: today, supplier: "", value: 0 },
    actionPlan: { problem: "", action: "", owner: state.config.owner || "", due: today, status: "Pendente" },
  };
  const row = { id: uid(), ...templates[collection] };
  state[collection] = [...state[collection], row];
  saveState();
  insertRemoteEntry(collection, row).catch((error) => {
    cloudNotice = `Erro ao inserir no Supabase: ${error.message}`;
    render();
  });
  render();
}

async function submitBlindEntry(collection, values) {
  const row = { id: uid(), ...values };
  state[collection] = [...state[collection], row];
  saveState();
  try {
    if (supabaseReady()) await insertRemoteEntry(collection, row, false);
    operatorNotice = supabaseReady()
      ? "Lançamento enviado com sucesso. Os valores não ficam visíveis neste modo."
      : "Lançamento salvo localmente. Configure o Supabase para o gestor acompanhar de outro lugar.";
  } catch (error) {
    operatorNotice = `Lançamento salvo neste aparelho, mas não foi enviado para a nuvem: ${error.message}. Tente novamente em Enviar dados salvos.`;
  }
  render();
}

async function submitOperatorForm(kind) {
  const get = (id) => document.getElementById(id)?.value || "";
  const number = (id) => Number(get(id) || 0);
  const today = new Date().toISOString().slice(0, 10);

  if (kind === "sales") {
    await submitBlindEntry("sales", {
      date: get("op-sale-date") || today,
      cash: number("op-sale-cash"),
      pix: number("op-sale-pix"),
      debit: number("op-sale-debit"),
      credit: number("op-sale-credit"),
    });
  }
  if (kind === "expenses") {
    await submitBlindEntry("expenses", {
      date: get("op-expense-date") || today,
      category: get("op-expense-category") || "Operação",
      description: get("op-expense-description"),
      value: number("op-expense-value"),
    });
  }
  if (kind === "payables") {
    await submitBlindEntry("payables", {
      due: get("op-payable-due") || today,
      description: get("op-payable-description"),
      category: get("op-payable-category") || "Operação",
      value: number("op-payable-value"),
      status: "Pendente",
    });
  }
  if (kind === "withdrawals") {
    await submitBlindEntry("withdrawals", {
      date: get("op-withdrawal-date") || today,
      reason: get("op-withdrawal-reason"),
      value: number("op-withdrawal-value"),
    });
  }
  if (kind === "consumption") {
    await submitBlindEntry("consumption", {
      date: get("op-consumption-date") || today,
      product: get("op-consumption-product"),
      quantity: number("op-consumption-quantity"),
      value: number("op-consumption-value"),
    });
  }
  if (kind === "stock") {
    await submitBlindEntry("stock", {
      date: get("op-stock-date") || today,
      supplier: get("op-stock-supplier"),
      value: number("op-stock-value"),
    });
  }
}

function deleteRow(collection, id) {
  state[collection] = state[collection].filter((row) => row.id !== id);
  saveState();
  deleteRemoteEntry(id).catch((error) => {
    cloudNotice = `Erro ao remover no Supabase: ${error.message}`;
    render();
  });
  render();
}

function seedDemo() {
  state = structuredClone(blank);
  state.config = { company: "Adega GH", owner: "Gustavo Henrique", month: "2026-06", cashInitial: 2800, bankInitial: 5200, investmentsInitial: 1000, stockInitial: 18500, managerPin: "1234", feePix: 0.99, feeDebit: 1.49, feeCredit: 3.49 };
  state.previousMonthCashFree = 6100;
  state.sales = [
    { id: uid(), date: "2026-06-01", cash: 780, pix: 1420, debit: 640, credit: 530 },
    { id: uid(), date: "2026-06-02", cash: 620, pix: 1280, debit: 590, credit: 430 },
    { id: uid(), date: "2026-06-03", cash: 840, pix: 1590, debit: 710, credit: 690 },
    { id: uid(), date: "2026-06-04", cash: 560, pix: 1160, debit: 540, credit: 410 },
  ];
  state.expenses = [
    { id: uid(), date: "2026-06-01", category: "Operação", description: "Energia e internet", value: 680 },
    { id: uid(), date: "2026-06-02", category: "Funcionários", description: "Diarista", value: 260 },
    { id: uid(), date: "2026-06-03", category: "Impostos", description: "DAS", value: 390 },
  ];
  state.payables = [
    { id: uid(), due: "2026-06-10", description: "Fornecedor cerveja", category: "Estoque", value: 2300, status: "Pendente" },
    { id: uid(), due: "2026-06-15", description: "Aluguel", category: "Operação", value: 1800, status: "Pendente" },
  ];
  state.debts = [{ id: uid(), creditor: "Banco", total: 12000, installment: 900, remaining: 7200, payoff: "2027-02-15" }];
  state.withdrawals = [{ id: uid(), date: "2026-06-02", reason: "Despesa pessoal", value: 850 }];
  state.consumption = [{ id: uid(), date: "2026-06-03", product: "Bebidas", quantity: 6, value: 180 }];
  state.stock = [{ id: uid(), date: "2026-06-01", supplier: "Distribuidora Norte", value: 3200 }];
  state.actionPlan = [{ id: uid(), problem: "Retirada sem limite semanal", action: "Definir teto fixo de retirada", owner: "Gustavo", due: "2026-06-08", status: "Em andamento" }];
  saveState();
  activeTab = "dashboard";
  render();
}

function clearData() {
  if (!confirm("Apagar todos os dados locais do GH Financeiro?")) return;
  state = structuredClone(blank);
  saveState();
  render();
}

function nextMonth(month) {
  const [year, monthNumber] = String(month || new Date().toISOString().slice(0, 7)).split("-").map(Number);
  const date = new Date(year || new Date().getFullYear(), monthNumber || 1, 1);
  return date.toISOString().slice(0, 7);
}

function snapshotSummary(m) {
  return {
    revenue: m.revenue,
    grossRevenue: m.grossRevenue,
    bankFees: m.bankFees,
    expenseTotal: m.expenseTotal,
    cashCurrent: m.cashCurrent,
    bankCurrent: m.bankCurrent,
    totalBalance: m.totalBalance,
    cashFree: m.cashFree,
    stock: m.stock,
    stockEstimated: m.stockEstimated,
    withdrawals: m.withdrawals,
    consumption: m.consumption,
    payablesPending: m.payablesPending,
    debtTotal: m.debtTotal,
    debtMonthly: m.debtMonthly,
    dailyTicket: m.dailyTicket,
    survivalDays: m.survivalDays,
    bleeding: m.bleeding,
  };
}

async function closeMonth() {
  if (accessMode !== "manager") return;
  const m = metrics();
  const currentMonth = state.config.month;
  const label = currentMonth || "mês atual";
  const confirmed = confirm(`Fechar ${label} e iniciar ${nextMonth(currentMonth)} com lançamentos zerados? O histórico ficará salvo.`);
  if (!confirmed) return;

  const snapshot = {
    id: uid(),
    month: currentMonth,
    company: state.config.company,
    summary: snapshotSummary(m),
    state: { ...structuredClone(state), monthlySnapshots: [] },
    created_at: new Date().toISOString(),
  };

  const previousSnapshots = state.monthlySnapshots || [];
  const newConfig = {
    ...state.config,
    month: nextMonth(currentMonth),
    cashInitial: Math.max(0, m.cashCurrent),
    bankInitial: Math.max(0, m.bankCurrent),
    stockInitial: Math.max(0, m.stockEstimated),
  };

  state = {
    ...structuredClone(blank),
    config: newConfig,
    debts: structuredClone(snapshot.state.debts || []),
    monthlySnapshots: [snapshot, ...previousSnapshots],
    previousMonthCashFree: m.cashFree,
  };
  saveState();

  try {
    await insertRemoteSnapshot(snapshot);
    await clearRemoteEntries();
    for (const debt of state.debts || []) {
      await insertRemoteEntry("debts", debt, true);
    }
    await saveRemoteSettings();
    cloudNotice = `Mês ${label} fechado e salvo no histórico. Novo mês iniciado em ${state.config.month}.`;
  } catch (error) {
    cloudNotice = `Fechamento salvo localmente, mas houve erro na nuvem: ${error.message}`;
  }
  activeTab = "dashboard";
  render();
}

function input(path, value, type = "text") {
  return `<input type="${type}" value="${escapeHtml(value)}" onchange="setDeep('${path}', this.value)" />`;
}

function field(label, html) {
  return `<div class="field"><label>${label}</label>${html}</div>`;
}

function rowInput(collection, row, key, type = "text") {
  return `<input type="${type}" value="${escapeHtml(row[key] ?? "")}" onchange="updateRow('${collection}','${row.id}','${key}', this.value)" />`;
}

function rowSelect(collection, row, key, options) {
  return `<select onchange="updateRow('${collection}','${row.id}','${key}', this.value)">${options
    .map((option) => `<option ${row[key] === option ? "selected" : ""}>${option}</option>`)
    .join("")}</select>`;
}

function removeButton(collection, row) {
  return `<button class="icon-btn" title="Remover" onclick="deleteRow('${collection}','${row.id}')">×</button>`;
}

function kpi(label, value, key, hint = "") {
  return `<article class="kpi"><div class="label"><span>${label}</span><span class="dot ${statusFor(key, num(String(value).replace(/[^0-9,-]/g, '').replace(',', '.')))}"></span></div><div class="value">${value}</div><small>${hint}</small></article>`;
}

function dashboard() {
  const m = metrics();
  return `
    <div class="kpis">
      ${kpi("Faturamento do mês", money(m.revenue), "blue", `Projeção: ${money(m.monthlyProjection)}`)}
      ${kpi("Taxas bancárias", money(m.bankFees), "blue", `Bruto: ${money(m.grossRevenue)}`)}
      ${kpi("Caixa atual", money(m.cashCurrent), "blue", "Entradas em dinheiro menos saídas")}
      ${kpi("Saldo bancário", money(m.bankCurrent), "blue", "PIX, cartões e pagamentos bancários")}
      ${kpi("Saldo total", money(m.totalBalance), "blue", "Caixa + banco + aplicações")}
      ${kpi("Contas a pagar", money(m.payablesPending), "cashFree", "Total ainda pendente")}
      ${kpi("Caixa livre", money(m.cashFree), "cashFree", `${pct(m.cashFreePct)} do faturamento`)}
      ${kpi("Compras de estoque", money(m.stock), "blue", `${pct(m.stockPct)} do faturamento`)}
      ${kpi("Estoque estimado", money(m.stockEstimated), "blue", "Inicial + compras - vendas líquidas - consumo")}
      ${kpi("Retiradas do proprietário", money(m.withdrawals), "withdrawalsPct", `${pct(m.withdrawalsPct)} do faturamento`)}
      ${kpi("Consumo próprio", money(m.consumption), "consumptionPct", `${pct(m.consumptionPct)} do faturamento`)}
      ${kpi("Dívidas pagas", money(m.paidDebts), "blue", `Parcelas mensais: ${money(m.debtMonthly)}`)}
      ${kpi("Ticket médio diário", money(m.dailyTicket), "blue", `${m.workedDays} dias trabalhados`)}
      ${kpi("Dias de sobrevivência", `${Math.max(0, Math.min(999, m.survivalDays)).toFixed(0)} dias`, "cashFree", "Caixa livre dividido por despesas médias")}
      ${kpi("Índice de sangramento", pct(m.bleeding), "bleeding", "Retiradas + consumo próprio")}
    </div>
    <div class="grid-2">
      <section class="section">
        <h3>Gráficos executivos</h3>
        <div class="charts">
          ${lineChart("Evolução do faturamento", state.sales.map((row) => [row.date, saleTotal(row)]), "#1b66d2")}
          ${lineChart("Evolução das despesas", state.expenses.map((row) => [row.date, num(row.value)]), "#dc2626")}
          ${barChart("Evolução do caixa livre", [["Inicial", m.initialTotal], ["Atual", m.totalBalance], ["Livre", m.cashFree]], "#12b4d8")}
          ${donutChart("Distribuição das despesas", Object.entries(m.expenseByCategory).filter(([, value]) => value > 0))}
          ${barChart("Compras de estoque", state.stock.map((row) => [row.supplier || row.date, num(row.value)]), "#0d2c55")}
          ${barChart("Retiradas", state.withdrawals.map((row) => [row.reason || row.date, num(row.value)]), "#d99813")}
          ${barChart("Consumo próprio", state.consumption.map((row) => [row.product || row.date, num(row.value)]), "#7c3aed")}
          ${lineChart("Evolução do caixa", [["Inicial", m.initialTotal], ["Caixa", m.cashCurrent], ["Banco", m.bankCurrent], ["Total", m.totalBalance]], "#16a34a")}
        </div>
      </section>
      <aside>
        <section class="section">
          <h3>Alertas inteligentes</h3>
          <div class="alert-list">${alerts(m).map(([color, text]) => `<div class="alert ${color}">${text}</div>`).join("")}</div>
        </section>
        <section class="section">
          <h3>Indicadores automáticos</h3>
          ${summary("Percentual de estoque", pct(m.stockPct))}
          ${summary("Despesas operacionais", pct(m.operationalPct))}
          ${summary("Percentual de retiradas", pct(m.withdrawalsPct))}
          ${summary("Consumo próprio", pct(m.consumptionPct))}
          ${summary("Endividamento", pct(m.debtPct))}
          ${summary("Caixa livre", pct(m.cashFreePct))}
        </section>
      </aside>
    </div>`;
}

function summary(label, value) {
  return `<div class="summary-row"><span>${label}</span><strong>${value}</strong></div>`;
}

function configView() {
  const m = metrics();
  return `<section class="section"><h3>Configuração inicial</h3><div class="form-grid">
    ${field("Nome da empresa", input("config.company", state.config.company))}
    ${field("Nome do proprietário", input("config.owner", state.config.owner))}
    ${field("Mês de análise", input("config.month", state.config.month, "month"))}
    ${field("Caixa inicial", input("config.cashInitial", state.config.cashInitial, "number"))}
    ${field("Conta bancária", input("config.bankInitial", state.config.bankInitial, "number"))}
    ${field("Aplicações", input("config.investmentsInitial", state.config.investmentsInitial, "number"))}
    ${field("Estoque inicial", input("config.stockInitial", state.config.stockInitial, "number"))}
    ${field("Taxa PIX (%)", input("config.feePix", state.config.feePix, "number"))}
    ${field("Taxa débito (%)", input("config.feeDebit", state.config.feeDebit, "number"))}
    ${field("Taxa crédito (%)", input("config.feeCredit", state.config.feeCredit, "number"))}
    ${field("PIN do gestor", input("config.managerPin", state.config.managerPin, "password"))}
    ${field("Caixa livre mês anterior", input("previousMonthCashFree", state.previousMonthCashFree, "number"))}
    <div><span class="pill">Saldo inicial total: ${money(m.initialTotal)}</span></div>
  </div></section>`;
}

function salesView() {
  const m = metrics();
  return dataSection("Vendas diárias", "sales", ["Data", "Dinheiro", "PIX", "Débito", "Crédito", "Bruto", "Taxa", "Líquido", ""], state.sales.map((row) => `
    <tr><td>${rowInput("sales", row, "date", "date")}</td><td>${rowInput("sales", row, "cash", "number")}</td><td>${rowInput("sales", row, "pix", "number")}</td><td>${rowInput("sales", row, "debit", "number")}</td><td>${rowInput("sales", row, "credit", "number")}</td><td><strong>${money(saleTotal(row))}</strong></td><td>${money(saleFeeTotal(row))}</td><td><strong>${money(saleNetTotal(row))}</strong></td><td>${removeButton("sales", row)}</td></tr>`).join(""),
    `<div class="legend"><span>Venda bruta: <strong>${money(m.grossRevenue)}</strong></span><span>Taxas: <strong>${money(m.bankFees)}</strong></span><span>Venda líquida: <strong>${money(m.revenue)}</strong></span><span>Média diária: <strong>${money(m.dailyTicket)}</strong></span><span>Projeção mensal: <strong>${money(m.monthlyProjection)}</strong></span></div>`);
}

function expensesView() {
  const m = metrics();
  return dataSection("Despesas", "expenses", ["Data", "Categoria", "Descrição", "Valor", ""], state.expenses.map((row) => `
    <tr><td>${rowInput("expenses", row, "date", "date")}</td><td>${rowSelect("expenses", row, "category", categories)}</td><td>${rowInput("expenses", row, "description")}</td><td>${rowInput("expenses", row, "value", "number")}</td><td>${removeButton("expenses", row)}</td></tr>`).join(""),
    `<div class="legend">${categories.map((cat) => `<span>${cat}: <strong>${money(m.expenseByCategory[cat])}</strong> (${pct(ratio(m.expenseByCategory[cat], m.expenseTotal))})</span>`).join("")}</div>`);
}

function payablesView() {
  const m = metrics();
  return dataSection("Contas a pagar", "payables", ["Vencimento", "Descrição", "Categoria", "Valor", "Status", ""], state.payables.map((row) => `
    <tr><td>${rowInput("payables", row, "due", "date")}</td><td>${rowInput("payables", row, "description")}</td><td>${rowSelect("payables", row, "category", categories)}</td><td>${rowInput("payables", row, "value", "number")}</td><td>${rowSelect("payables", row, "status", ["Pendente", "Pago"])}</td><td>${removeButton("payables", row)}</td></tr>`).join(""),
    `<div class="legend"><span>Total pendente: <strong>${money(m.payablesPending)}</strong></span><span>Total pago: <strong>${money(m.payablesPaid)}</strong></span></div>`);
}

function debtsView() {
  const m = metrics();
  return dataSection("Dívidas antigas", "debts", ["Credor", "Valor total", "Parcela mensal", "Saldo restante", "Quitação prevista", ""], state.debts.map((row) => `
    <tr><td>${rowInput("debts", row, "creditor")}</td><td>${rowInput("debts", row, "total", "number")}</td><td>${rowInput("debts", row, "installment", "number")}</td><td>${rowInput("debts", row, "remaining", "number")}</td><td>${rowInput("debts", row, "payoff", "date")}</td><td>${removeButton("debts", row)}</td></tr>`).join(""),
    `<div class="legend"><span>Total de dívidas: <strong>${money(m.debtTotal)}</strong></span><span>Comprometimento mensal: <strong>${money(m.debtMonthly)}</strong></span></div>`);
}

function simpleMoneyView(title, collection, cols, extra) {
  return dataSection(title, collection, cols.map((col) => col[0]).concat([""]), state[collection].map((row) => `
    <tr>${cols.map((col) => `<td>${rowInput(collection, row, col[1], col[2] || "text")}</td>`).join("")}<td>${removeButton(collection, row)}</td></tr>`).join(""), extra);
}

function actionView() {
  return dataSection("Plano de ação do mês", "actionPlan", ["Problema identificado", "Ação corretiva", "Responsável", "Prazo", "Status", ""], state.actionPlan.map((row) => `
    <tr><td>${rowInput("actionPlan", row, "problem")}</td><td>${rowInput("actionPlan", row, "action")}</td><td>${rowInput("actionPlan", row, "owner")}</td><td>${rowInput("actionPlan", row, "due", "date")}</td><td>${rowSelect("actionPlan", row, "status", ["Pendente", "Em andamento", "Concluído"])}</td><td>${removeButton("actionPlan", row)}</td></tr>`).join(""));
}

function historyView() {
  const rows = (state.monthlySnapshots || []).map((snapshot) => {
    const s = snapshot.summary || {};
    return `<tr>
      <td><strong>${escapeHtml(snapshot.month || "-")}</strong></td>
      <td>${escapeHtml(snapshot.company || state.config.company || "-")}</td>
      <td>${money(s.revenue)}</td>
      <td>${money(s.expenseTotal)}</td>
      <td>${money(s.cashFree)}</td>
      <td>${money(s.stockEstimated)}</td>
      <td>${pct(s.bleeding || 0)}</td>
      <td>${escapeHtml(String(snapshot.created_at || "").slice(0, 10))}</td>
    </tr>`;
  }).join("");

  return `<section class="section">
    <div class="topbar" style="margin-bottom:12px">
      <h3>Histórico mensal</h3>
      <button class="btn" onclick="closeMonth()">Fechar mês atual</button>
    </div>
    <div class="legend"><span>O fechamento guarda o mês atual e inicia o próximo com vendas, despesas, contas, retiradas, consumo, estoque e plano de ação zerados.</span></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Mês</th><th>Empresa</th><th>Faturamento líquido</th><th>Despesas</th><th>Caixa livre</th><th>Estoque estimado</th><th>Sangramento</th><th>Fechado em</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="8">Nenhum mês fechado ainda.</td></tr>`}</tbody>
    </table></div>
  </section>`;
}

function dataSection(title, collection, headers, rows, footer = "") {
  return `<section class="section"><div class="topbar" style="margin-bottom:12px"><h3>${title}</h3><button class="btn" onclick="addRow('${collection}')">Adicionar</button></div>${footer}<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}">Nenhum lançamento cadastrado.</td></tr>`}</tbody></table></div></section>`;
}

function barChart(title, data, color) {
  const clean = data.filter(([, value]) => Number.isFinite(value));
  const max = Math.max(...clean.map(([, value]) => Math.abs(value)), 1);
  const bars = clean.slice(-8).map(([label, value], i) => {
    const h = Math.max(4, (Math.abs(value) / max) * 150);
    const x = 26 + i * 48;
    return `<rect x="${x}" y="${170 - h}" width="28" height="${h}" rx="4" fill="${color}"></rect><text x="${x + 14}" y="194" text-anchor="middle" font-size="10" fill="#64748b">${escapeHtml(String(label).slice(0, 7))}</text>`;
  }).join("");
  return `<div class="chart"><h3>${title}</h3><svg viewBox="0 0 420 220"><line x1="18" y1="170" x2="402" y2="170" stroke="#dbe3ef"></line>${bars || emptyChart()}</svg></div>`;
}

function lineChart(title, data, color) {
  const clean = data.filter(([, value]) => Number.isFinite(value));
  const max = Math.max(...clean.map(([, value]) => value), 1);
  const points = clean.slice(-10).map(([, value], i, arr) => {
    const x = 24 + (i * 360) / Math.max(1, arr.length - 1);
    const y = 170 - (value / max) * 140;
    return [x, y];
  });
  const path = points.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
  return `<div class="chart"><h3>${title}</h3><svg viewBox="0 0 420 220"><line x1="18" y1="170" x2="402" y2="170" stroke="#dbe3ef"></line>${points.length ? `<path d="${path}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"></path>${points.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="${color}"></circle>`).join("")}` : emptyChart()}</svg></div>`;
}

function donutChart(title, data) {
  const total = data.reduce((sum, [, value]) => sum + value, 0);
  const colors = ["#1b66d2", "#12b4d8", "#16a34a", "#d99813", "#dc2626", "#7c3aed", "#0d2c55", "#64748b"];
  let acc = 0;
  const circles = data.map(([label, value], i) => {
    const dash = total ? (value / total) * 100 : 0;
    const circle = `<circle r="54" cx="110" cy="92" fill="transparent" stroke="${colors[i % colors.length]}" stroke-width="24" stroke-dasharray="${dash} ${100 - dash}" stroke-dashoffset="${25 - acc}"></circle>`;
    acc += dash;
    return circle;
  }).join("");
  return `<div class="chart"><h3>${title}</h3><svg viewBox="0 0 420 220">${total ? `<g transform="rotate(-90 110 92)">${circles}</g><text x="110" y="98" text-anchor="middle" font-size="18" font-weight="800">${money(total)}</text><g>${data.map(([label, value], i) => `<text x="205" y="${48 + i * 20}" fill="#64748b" font-size="12">${escapeHtml(label)}: ${pct(ratio(value, total))}</text>`).join("")}</g>` : emptyChart()}</svg></div>`;
}

function emptyChart() {
  return `<text x="210" y="110" text-anchor="middle" fill="#64748b" font-size="13">Sem dados suficientes</text>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function operatorCard(title, kind, fields) {
  return `<section class="section operator-card">
    <h3>${title}</h3>
    <div class="form-grid">${fields.map(([label, id, type, extra]) => field(label, fieldControl(id, type, extra))).join("")}</div>
    <button class="btn" onclick="submitOperatorForm('${kind}')">Salvar lançamento</button>
  </section>`;
}

function fieldControl(id, type = "text", extra = "") {
  const today = new Date().toISOString().slice(0, 10);
  if (type === "select-category") {
    return `<select id="${id}">${categories.map((cat) => `<option>${cat}</option>`).join("")}</select>`;
  }
  return `<input id="${id}" type="${type}" value="${type === "date" ? today : ""}" ${extra} />`;
}

function operatorView() {
  return `
    <main class="operator-shell">
      <header class="operator-header">
        <div class="brand"><div class="mark">GH</div><div><h1>GH Financeiro</h1><p>Modo lançamento</p></div></div>
        <div class="actions">
          <button class="btn secondary" onclick="syncLocalEntriesAsOperator()">Enviar dados salvos</button>
          <button class="btn secondary" onclick="setAccessMode('manager')">Entrar como gestor</button>
        </div>
      </header>
      <section class="operator-hero">
        <p class="eyebrow">Preenchimento diário</p>
        <h2>${escapeHtml(state.config.company || "GH Financeiro")}</h2>
        <p>Registre os dados do dia. Neste modo, totais, histórico, relatórios e indicadores ficam ocultos.</p>
        ${operatorNotice ? `<div class="alert green">${operatorNotice}</div>` : ""}
      </section>
      <div class="operator-grid">
        ${operatorCard("Vendas diárias", "sales", [["Data", "op-sale-date", "date"], ["Dinheiro", "op-sale-cash", "number"], ["PIX", "op-sale-pix", "number"], ["Cartão débito", "op-sale-debit", "number"], ["Cartão crédito", "op-sale-credit", "number"]])}
        ${operatorCard("Despesa", "expenses", [["Data", "op-expense-date", "date"], ["Categoria", "op-expense-category", "select-category"], ["Descrição", "op-expense-description"], ["Valor", "op-expense-value", "number"]])}
        ${operatorCard("Conta a pagar", "payables", [["Vencimento", "op-payable-due", "date"], ["Categoria", "op-payable-category", "select-category"], ["Descrição", "op-payable-description"], ["Valor", "op-payable-value", "number"]])}
        ${operatorCard("Retirada do proprietário", "withdrawals", [["Data", "op-withdrawal-date", "date"], ["Motivo", "op-withdrawal-reason"], ["Valor", "op-withdrawal-value", "number"]])}
        ${operatorCard("Consumo próprio", "consumption", [["Data", "op-consumption-date", "date"], ["Produto", "op-consumption-product"], ["Quantidade", "op-consumption-quantity", "number"], ["Valor", "op-consumption-value", "number"]])}
        ${operatorCard("Compra de estoque", "stock", [["Data", "op-stock-date", "date"], ["Fornecedor", "op-stock-supplier"], ["Valor", "op-stock-value", "number"]])}
      </div>
    </main>`;
}

function report() {
  const m = metrics();
  return `<div class="print-report">
    <h1>GH Financeiro - Relatório mensal</h1>
    <p>${escapeHtml(state.config.company)} | Mês ${escapeHtml(state.config.month)}</p>
    <div class="kpis">${kpi("Faturamento líquido", money(m.revenue), "blue")}${kpi("Taxas bancárias", money(m.bankFees), "blue")}${kpi("Estoque estimado", money(m.stockEstimated), "blue")}${kpi("Caixa livre", money(m.cashFree), "cashFree")}${kpi("Saldo total", money(m.totalBalance), "blue")}${kpi("Sangramento", pct(m.bleeding), "bleeding")}</div>
    <section class="section"><h3>Alertas</h3>${alerts(m).map(([, text]) => `<p>${text}</p>`).join("")}</section>
    <section class="section"><h3>Plano de ação</h3><table><thead><tr><th>Problema</th><th>Ação</th><th>Responsável</th><th>Prazo</th><th>Status</th></tr></thead><tbody>${state.actionPlan.map((row) => `<tr><td>${escapeHtml(row.problem)}</td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(row.owner)}</td><td>${escapeHtml(row.due)}</td><td>${escapeHtml(row.status)}</td></tr>`).join("")}</tbody></table></section>
  </div>`;
}

function cloudControls() {
  if (!supabaseReady()) {
    return `<button class="btn secondary" onclick="alert('Preencha url e anonKey em supabase-config.js para publicar com dados compartilhados.')">Nuvem off</button>`;
  }
  if (!authToken()) {
    return `<button class="btn secondary" onclick="managerLogin()">Login gestor</button>`;
  }
  return `
    <button class="btn secondary" onclick="refreshCloud()">Atualizar nuvem</button>
    <button class="btn secondary" onclick="managerLogout()">Sair</button>`;
}

async function refreshCloud() {
  try {
    await loadRemoteState();
    cloudNotice = "Dados atualizados do Supabase.";
  } catch (error) {
    cloudNotice = `Erro ao atualizar Supabase: ${error.message}`;
  }
  render();
}

function currentView() {
  const m = metrics();
  const views = {
    dashboard,
    config: configView,
    sales: salesView,
    expenses: expensesView,
    payables: payablesView,
    debts: debtsView,
    withdrawals: () => simpleMoneyView("Retiradas do proprietário", "withdrawals", [["Data", "date", "date"], ["Motivo", "reason"], ["Valor", "value", "number"]], `<div class="legend"><span>Total retirado: <strong>${money(m.withdrawals)}</strong></span><span>Percentual: <strong>${pct(m.withdrawalsPct)}</strong></span></div>`),
    consumption: () => simpleMoneyView("Consumo próprio", "consumption", [["Data", "date", "date"], ["Produto", "product"], ["Quantidade", "quantity", "number"], ["Valor", "value", "number"]], `<div class="legend"><span>Total consumido: <strong>${money(m.consumption)}</strong></span><span>Percentual: <strong>${pct(m.consumptionPct)}</strong></span></div>`),
    stock: () => simpleMoneyView("Compras de estoque", "stock", [["Data", "date", "date"], ["Fornecedor", "supplier"], ["Valor", "value", "number"]], `<div class="legend"><span>Total investido: <strong>${money(m.stock)}</strong></span><span>Percentual: <strong>${pct(m.stockPct)}</strong></span></div>`),
    action: actionView,
    history: historyView,
  };
  return views[activeTab]();
}

function render() {
  if (accessMode === "operator") {
    document.getElementById("app").innerHTML = operatorView();
    return;
  }
  const m = metrics();
  document.getElementById("app").innerHTML = `
    <main class="shell">
      <aside class="sidebar">
        <div class="brand"><div class="mark">GH</div><div><h1>GH Financeiro</h1><p>${escapeHtml(state.config.company || "Gestão financeira")}</p></div></div>
        <nav class="nav">${tabs.map(([id, label]) => `<button class="${activeTab === id ? "active" : ""}" onclick="activeTab='${id}'; render()"><span>${label}</span><span>›</span></button>`).join("")}</nav>
      </aside>
      <section class="content">
        <div class="topbar no-print">
          <div><p class="eyebrow">Dashboard executivo</p><h2>${escapeHtml(state.config.company || "GH Financeiro")}</h2><p>Preenchimento diário simples, indicadores automáticos e plano de ação mensal.</p></div>
          <div class="actions">
            ${cloudControls()}
            <button class="btn secondary" onclick="closeMonth()">Fechar mês</button>
            <button class="btn secondary" onclick="setAccessMode('operator')">Modo lançamento</button>
            <button class="btn secondary" onclick="seedDemo()">Carregar exemplo</button>
            <button class="btn secondary" onclick="clearData()">Limpar dados</button>
            <button class="btn" onclick="window.print()">Gerar relatório</button>
          </div>
        </div>
        ${cloudNotice ? `<div class="alert ${cloudNotice.includes("Erro") ? "yellow" : "green"} no-print">${escapeHtml(cloudNotice)}</div>` : ""}
        <div class="tabs-view">${currentView()}</div>
        ${report()}
      </section>
    </main>`;
}

window.setDeep = setDeep;
window.updateRow = updateRow;
window.addRow = addRow;
window.deleteRow = deleteRow;
window.seedDemo = seedDemo;
window.clearData = clearData;
window.setAccessMode = setAccessMode;
window.submitOperatorForm = submitOperatorForm;
window.syncLocalEntriesAsOperator = syncLocalEntriesAsOperator;
window.closeMonth = closeMonth;
window.managerLogin = managerLogin;
window.managerLogout = managerLogout;
window.refreshCloud = refreshCloud;
window.render = render;

render();
if (supabaseReady() && authToken() && accessMode === "manager") {
  refreshCloud();
}
