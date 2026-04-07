import { formatCurrency } from '@/lib/format';
import { addExpenseAction } from '@/server/actions/hapos';
import { requireSession } from '@/server/auth/demo-session';
import { getFinancialRows, listExpenses } from '@/server/services/app-data';

export default async function ExpensesPage() {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return null;
  }

  const [expenses, financialRows] = await Promise.all([
    listExpenses(session.tenant.id),
    getFinancialRows(session.tenant.id),
  ]);

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Expense tracking</p>
        <h1 className="hero-title">Know what the shop really kept.</h1>
        <p className="hero-subtitle">
          Expenses feed directly into daily and monthly profit calculations so admin users can see operational reality, not just gross sales.
        </p>
      </section>

      <section className="grid-two">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Logged expenses</h2>
              <p className="panel-copy">Admin-only workspace for rent, utilities, stock, and daily operating costs.</p>
            </div>
          </div>

          <form action={addExpenseAction} className="field-grid" style={{ marginBottom: 24 }}>
            <div className="field">
              <label htmlFor="category">Category</label>
              <input id="category" name="category" required />
            </div>
            <div className="field">
              <label htmlFor="description">Description</label>
              <textarea id="description" name="description" />
            </div>
            <div className="field">
              <label htmlFor="amount">Amount</label>
              <input id="amount" name="amount" type="number" min="0" step="1" required />
            </div>
            <div className="field">
              <label htmlFor="expenseDate">Date</label>
              <input id="expenseDate" name="expenseDate" type="date" required />
            </div>
            <div className="hero-actions">
              <button type="submit" className="button">
                Record expense
              </button>
            </div>
          </form>

          <table className="table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Description</th>
                <th>Date</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((expense) => (
                <tr key={expense.id}>
                  <td>{expense.category}</td>
                  <td>{expense.description}</td>
                  <td>{expense.expenseDate}</td>
                  <td>{formatCurrency(expense.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Daily profit rows</h2>
              <p className="panel-copy">Income minus expenses and paid commissions.</p>
            </div>
          </div>

          <div className="stack">
            {financialRows.map((row) => (
              <div className="list-row" key={row.period}>
                <div>
                  <strong>{row.period}</strong>
              <div className="eyebrow">
                    Income {formatCurrency(row.income)} / Expenses {formatCurrency(row.expenses)} / Product costs {formatCurrency(row.productCosts)}
                  </div>
                </div>
                <strong style={{ color: row.netProfit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {formatCurrency(row.netProfit)}
                </strong>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
