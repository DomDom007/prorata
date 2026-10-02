// Prorata: shared expenses split by each person's share of income.
import { useMemo, useState } from "react";
import { download, uid, useStored } from "./lib/store";

type Person = { id: string; name: string; income: number };
type Expense = { id: string; date: string; what: string; category: string; amount: number; paidBy: string; split: "income" | "equal" };
type Transfer = { id: string; date: string; from: string; to: string; amount: number };

const T = "prorata";
const CURRENCIES = ["TND", "EUR", "USD", "GBP", "MAD", "DZD", "CAD", "AED", "SAR"];
const CATEGORIES = ["Rent", "Groceries", "Bills", "Transport", "Home", "Eating out", "Kids", "Holidays", "Other"];
const today = () => new Date().toISOString().slice(0, 10);
const month = (d: string) => d.slice(0, 7);

const SAMPLE_PEOPLE: Person[] = [
  { id: "a", name: "Sami", income: 3200 },
  { id: "b", name: "Leila", income: 1800 },
];
function sampleExpenses(): Expense[] {
  const m = month(today());
  return [
    { id: uid(), date: `${m}-01`, what: "Rent", category: "Rent", amount: 1200, paidBy: "a", split: "income" },
    { id: uid(), date: `${m}-03`, what: "Weekly shop", category: "Groceries", amount: 186.4, paidBy: "b", split: "income" },
    { id: uid(), date: `${m}-05`, what: "Electricity and water", category: "Bills", amount: 142, paidBy: "b", split: "income" },
    { id: uid(), date: `${m}-08`, what: "Dinner with friends", category: "Eating out", amount: 90, paidBy: "a", split: "equal" },
  ];
}

export default function Prorata() {
  const [currency, setCurrency] = useStored(T, "currency", "TND");
  const [people, setPeople] = useStored<Person[]>(T, "people", SAMPLE_PEOPLE);
  const [expenses, setExpenses] = useStored<Expense[]>(T, "expenses", sampleExpenses());
  const [transfers, setTransfers] = useStored<Transfer[]>(T, "transfers", []);
  const [isSample, setIsSample] = useStored(T, "sample", true);
  const [view, setView] = useState(month(today()));

  const fmt = useMemo(() => {
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }); }
    catch { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }); }
  }, [currency]);
  const money = (n: number) => fmt.format(Math.abs(n) < 0.005 ? 0 : n);

  const totalIncome = people.reduce((s, p) => s + (p.income || 0), 0);
  const shareOf = (id: string) => {
    const p = people.find(x => x.id === id);
    return totalIncome > 0 && p ? (p.income || 0) / totalIncome : 1 / Math.max(people.length, 1);
  };
  const nameOf = (id: string) => people.find(p => p.id === id)?.name || "Someone";

  const monthExpenses = expenses.filter(e => month(e.date) === view).sort((a, b) => b.date.localeCompare(a.date));
  const monthTransfers = transfers.filter(t => month(t.date) === view);
  const months = Array.from(new Set([month(today()), ...expenses.map(e => month(e.date)), ...transfers.map(t => month(t.date))])).sort().reverse();

  // For every person: what they paid, what their fair share was, and the balance (positive = is owed money).
  const rows = people.map(p => {
    const paid = monthExpenses.filter(e => e.paidBy === p.id).reduce((s, e) => s + e.amount, 0);
    const fair = monthExpenses.reduce((s, e) => s + e.amount * (e.split === "equal" ? 1 / people.length : shareOf(p.id)), 0);
    const sent = monthTransfers.filter(t => t.from === p.id).reduce((s, t) => s + t.amount, 0);
    const got = monthTransfers.filter(t => t.to === p.id).reduce((s, t) => s + t.amount, 0);
    return { ...p, paid, fair, balance: paid - fair + sent - got };
  });
  const total = monthExpenses.reduce((s, e) => s + e.amount, 0);

  // Greedy settle-up: fewest payments from people who owe to people who are owed.
  const settle = (() => {
    const debt = rows.filter(r => r.balance < -0.005).map(r => ({ id: r.id, v: -r.balance })).sort((a, b) => b.v - a.v);
    const cred = rows.filter(r => r.balance > 0.005).map(r => ({ id: r.id, v: r.balance })).sort((a, b) => b.v - a.v);
    const out: { from: string; to: string; amount: number }[] = [];
    let i = 0, j = 0;
    while (i < debt.length && j < cred.length) {
      const v = Math.min(debt[i].v, cred[j].v);
      out.push({ from: debt[i].id, to: cred[j].id, amount: Math.round(v * 100) / 100 });
      debt[i].v -= v; cred[j].v -= v;
      if (debt[i].v < 0.005) i++;
      if (cred[j].v < 0.005) j++;
    }
    return out;
  })();

  // New expense form
  const [draft, setDraft] = useState({ date: today(), what: "", category: "Groceries", amount: "", paidBy: people[0]?.id ?? "", split: "income" as Expense["split"] });
  const [err, setErr] = useState("");
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(draft.amount.replace(",", "."));
    if (!draft.what.trim()) return setErr("Add a short description, like “Weekly shop”.");
    if (!(amount > 0)) return setErr("Enter an amount above zero.");
    if (!people.some(p => p.id === draft.paidBy)) return setErr("Choose who paid.");
    setExpenses([...expenses, { id: uid(), date: draft.date, what: draft.what.trim(), category: draft.category, amount, paidBy: draft.paidBy, split: draft.split }]);
    setDraft({ ...draft, what: "", amount: "" });
    setErr("");
    setView(month(draft.date));
  };

  const clearSample = () => { setExpenses([]); setTransfers([]); setIsSample(false); };
  const exportCsv = () => {
    const lines = [["Date", "Description", "Category", "Amount", "Paid by", "Split"].join(",")];
    monthExpenses.forEach(e => lines.push([e.date, `"${e.what.replace(/"/g, '""')}"`, e.category, e.amount.toFixed(2), nameOf(e.paidBy), e.split === "equal" ? "Equal" : "By income"].join(",")));
    download(`prorata-${view}.csv`, lines.join("\n"), "text/csv");
  };
  const monthLabel = (m: string) => new Date(m + "-15").toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="stack">
      {isSample && (
        <div className="panel row" style={{ alignItems: "center", justifyContent: "space-between" }}>
          <p><span className="pill warn">Example</span> These are sample numbers so you can see how it works. Edit the people below, then clear the example expenses.</p>
          <button className="btn" onClick={clearSample}>Clear example expenses</button>
        </div>
      )}

      <div className="grid2">
        <section className="panel">
          <h2>Who shares the costs</h2>
          <div className="stack" style={{ gap: 12 }}>
            {people.map((p, i) => (
              <div className="row" key={p.id}>
                <label className="field"><span>Name</span>
                  <input id={`pr-name-${p.id}`} className="input" value={p.name} onChange={e => setPeople(people.map(x => x.id === p.id ? { ...x, name: e.target.value } : x))} />
                </label>
                <label className="field"><span>Monthly income</span>
                  <input id={`pr-inc-${p.id}`} className="input num" inputMode="decimal" value={p.income || ""} onChange={e => setPeople(people.map(x => x.id === p.id ? { ...x, income: parseFloat(e.target.value) || 0 } : x))} />
                </label>
                <div className="field" style={{ flex: "0 0 auto" }}><span>Share</span><strong className="num" style={{ padding: "9px 0" }}>{Math.round(shareOf(p.id) * 100)}%</strong></div>
                {people.length > 2 && i > 0 && (
                  <button className="btn ghost small danger" onClick={() => setPeople(people.filter(x => x.id !== p.id))} aria-label={`Remove ${p.name}`}>Remove</button>
                )}
              </div>
            ))}
            <div className="row" style={{ alignItems: "center" }}>
              <button className="btn small" onClick={() => setPeople([...people, { id: uid(), name: `Person ${people.length + 1}`, income: 0 }])}>Add a person</button>
              <label className="field" style={{ flex: "0 0 120px" }}><span>Currency</span>
                <select id="pr-cur" className="input" value={currency} onChange={e => setCurrency(e.target.value)}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select>
              </label>
            </div>
            {totalIncome === 0 && <p className="pill warn">Add incomes to split by income. Until then costs split equally.</p>}
          </div>
        </section>

        <section className="panel">
          <h2>Add an expense</h2>
          <form className="stack" style={{ gap: 12 }} onSubmit={add}>
            <div className="row">
              <label className="field" style={{ flexGrow: 2 }}><span>What</span>
                <input id="pr-what" className="input" value={draft.what} onChange={e => setDraft({ ...draft, what: e.target.value })} placeholder="Weekly shop" />
              </label>
              <label className="field"><span>Amount</span>
                <input id="pr-amount" className="input num" inputMode="decimal" value={draft.amount} onChange={e => setDraft({ ...draft, amount: e.target.value })} placeholder="0.00" />
              </label>
            </div>
            <div className="row">
              <label className="field"><span>Paid by</span>
                <select id="pr-paid" className="input" value={draft.paidBy} onChange={e => setDraft({ ...draft, paidBy: e.target.value })}>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </label>
              <label className="field"><span>Category</span>
                <select id="pr-cat" className="input" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
              </label>
              <label className="field"><span>Date</span>
                <input id="pr-date" type="date" className="input" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} />
              </label>
            </div>
            <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
              <div className="seg-mini" role="group" aria-label="How to split">
                <button type="button" aria-pressed={draft.split === "income"} onClick={() => setDraft({ ...draft, split: "income" })}>Split by income</button>
                <button type="button" aria-pressed={draft.split === "equal"} onClick={() => setDraft({ ...draft, split: "equal" })}>Split equally</button>
              </div>
              <button className="btn primary" type="submit">Add expense</button>
            </div>
            {err && <p className="pill bad">{err}</p>}
          </form>
        </section>
      </div>

      <section className="panel">
        <div className="row" style={{ alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>{monthLabel(view)}</h2>
          <div className="row" style={{ alignItems: "center" }}>
            <select id="pr-month" className="input" style={{ width: "auto" }} value={view} onChange={e => setView(e.target.value)} aria-label="Month">
              {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
            <button className="btn small" onClick={exportCsv} disabled={!monthExpenses.length}>Export CSV</button>
          </div>
        </div>

        <div className="row" style={{ gap: 32, marginBottom: 20 }}>
          <div className="stat"><b>{money(total)}</b><span>Shared this month</span></div>
          {rows.map(r => (
            <div className="stat" key={r.id}><b>{money(r.fair)}</b><span>{r.name}'s fair share</span></div>
          ))}
        </div>

        <div className="settle">
          {settle.length === 0 ? (
            <p><span className="pill good">All square</span> {monthExpenses.length ? "Nobody owes anything for this month." : "No expenses yet for this month."}</p>
          ) : settle.map((s, i) => (
            <div className="settle-row" key={i}>
              <p><strong>{nameOf(s.from)}</strong> pays <strong>{nameOf(s.to)}</strong> <span className="settle-amt num">{money(s.amount)}</span></p>
              <button className="btn small" onClick={() => setTransfers([...transfers, { id: uid(), date: view === month(today()) ? today() : `${view}-28`, from: s.from, to: s.to, amount: s.amount }])}>Mark as paid</button>
            </div>
          ))}
        </div>

        <div className="table-wrap" style={{ marginTop: 18 }}>
          <table className="t">
            <thead><tr><th>Person</th><th className="r">Paid</th><th className="r">Fair share</th><th className="r">Balance</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td>{r.name} <span className="pill">{Math.round(shareOf(r.id) * 100)}%</span></td>
                  <td className="r">{money(r.paid)}</td>
                  <td className="r">{money(r.fair)}</td>
                  <td className="r" style={{ color: r.balance > 0.005 ? "var(--good)" : r.balance < -0.005 ? "var(--bad)" : undefined }}>
                    {r.balance > 0.005 ? "is owed " : r.balance < -0.005 ? "owes " : ""}{money(Math.abs(r.balance))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Expenses</h2>
        {monthExpenses.length === 0 && monthTransfers.length === 0 ? (
          <p className="empty-note">No expenses in {monthLabel(view)} yet. Add one above.</p>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Date</th><th>What</th><th>Paid by</th><th>Split</th><th className="r">Amount</th><th /></tr></thead>
              <tbody>
                {monthExpenses.map(e => (
                  <tr key={e.id}>
                    <td className="num">{e.date.slice(5)}</td>
                    <td>{e.what} <span className="pill">{e.category}</span></td>
                    <td>{nameOf(e.paidBy)}</td>
                    <td>{e.split === "equal" ? "Equally" : "By income"}</td>
                    <td className="r">{money(e.amount)}</td>
                    <td className="r"><button className="btn ghost small danger" onClick={() => setExpenses(expenses.filter(x => x.id !== e.id))} aria-label={`Delete ${e.what}`}>Delete</button></td>
                  </tr>
                ))}
                {monthTransfers.map(t => (
                  <tr key={t.id}>
                    <td className="num">{t.date.slice(5)}</td>
                    <td colSpan={3}><span className="pill good">Settled</span> {nameOf(t.from)} paid {nameOf(t.to)}</td>
                    <td className="r">{money(t.amount)}</td>
                    <td className="r"><button className="btn ghost small danger" onClick={() => setTransfers(transfers.filter(x => x.id !== t.id))}>Undo</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <style>{`
        .settle{display:flex;flex-direction:column;gap:10px;padding:16px;border-radius:10px;background:var(--sunk)}
        .settle-row{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center}
        .settle-row p{font-size:18px}
        .settle-amt{font-family:var(--serif);font-size:26px;margin-left:6px}
      `}</style>
    </div>
  );
}
