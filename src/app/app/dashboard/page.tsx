import { DollarSign, TrendingUp, Briefcase, CalendarDays, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { requireSession } from '@/server/auth/demo-session';
import { getDashboardSummary, getStaffMetrics } from '@/server/services/app-data';

function formatDelta(value: number) {
  if (value === 0) {
    return formatCurrency(0);
  }

  return `${value > 0 ? '+' : '-'}${formatCurrency(Math.abs(value))}`;
}

function getDeltaClass(value: number) {
  if (value > 0) {return 'trend-positive';}
  if (value < 0) {return 'trend-negative';}
  return 'trend-neutral';
}

function DeltaIcon({ value }: { value: number }) {
  if (value > 0) {return <ArrowUpRight size={14} />;}
  if (value < 0) {return <ArrowDownRight size={14} />;}
  return <Minus size={14} />;
}

function KpiCard({ icon: Icon, label, value, trend }: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  trend?: { value: number; label: string };
}) {
  return (
    <div className="kpi-card">
      <div className="kpi-card-header">
        <span className="kpi-card-label">{label}</span>
        <span className="kpi-card-icon"><Icon /></span>
      </div>
      <div className="kpi-card-value">{value}</div>
      {trend ? (
        <div className={`kpi-card-trend ${getDeltaClass(trend.value)}`}>
          <DeltaIcon value={trend.value} />
          <span>{formatDelta(trend.value)}</span>
          <span>{trend.label}</span>
        </div>
      ) : null}
    </div>
  );
}

export default async function DashboardPage() {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  if (!session.tenant) {
    return null;
  }

  const [summary, staffMetrics] = await Promise.all([
    getDashboardSummary(session),
    session.user.role === 'staff' ? getStaffMetrics(session.tenant.id, session.user.id) : Promise.resolve(null),
  ]);

  const revenueDelta = summary.monthRevenue - summary.previousMonthRevenue;
  const commissionDelta = summary.monthCommissionAccrued - summary.previousMonthCommissionAccrued;

  const isStaff = session.user.role === 'staff';

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">
          <TrendingUp size={14} />
          {isStaff ? 'Staff dashboard' : 'Shop dashboard'}
        </p>
        <h1 className="hero-title">{session.tenant.name}</h1>
        <p className="hero-subtitle">
          {isStaff
            ? 'Your sales, commissions, and contribution at a glance.'
            : 'Track shop income, staff output, commissions, and momentum.'}
        </p>
        {!isStaff && summary.highestEarner ? (
          <div className="hero-actions">
            <span className="pill">
              <TrendingUp size={14} />
              Top earner: {summary.highestEarner.staffName} / {formatCurrency(summary.highestEarner.totalRevenue)}
            </span>
          </div>
        ) : null}
      </section>

      <section className="kpi-grid">
        {isStaff && staffMetrics ? (
          <>
            <KpiCard icon={DollarSign} label="Today sales" value={formatCurrency(staffMetrics.todaySales)} />
            <KpiCard icon={CalendarDays} label="This month" value={formatCurrency(staffMetrics.monthSales)} />
            <KpiCard icon={Briefcase} label="Commission" value={formatCurrency(staffMetrics.monthCommission)} trend={{ value: commissionDelta, label: 'vs last month' }} />
            <KpiCard icon={TrendingUp} label="Lifetime income" value={formatCurrency(summary.lifetimeRevenue)} />
          </>
        ) : (
          <>
            <KpiCard icon={DollarSign} label="Today revenue" value={formatCurrency(summary.todayRevenue)} />
            <KpiCard icon={CalendarDays} label="This month" value={formatCurrency(summary.monthRevenue)} trend={{ value: revenueDelta, label: 'vs last month' }} />
            <KpiCard icon={Briefcase} label="Commission" value={formatCurrency(summary.monthCommissionAccrued)} trend={{ value: commissionDelta, label: 'vs last month' }} />
            <KpiCard icon={TrendingUp} label="Total income" value={formatCurrency(summary.lifetimeRevenue)} />
          </>
        )}
      </section>

      <section className="grid-two">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Month comparison</h2>
              <p className="panel-copy">
                Compare the current month with the previous one.
              </p>
            </div>
          </div>

          <div className="comparison-grid">
            <article className="comparison-card">
              <span className="comparison-label">{summary.currentMonthLabel}</span>
              <strong className="comparison-value">{formatCurrency(summary.monthRevenue)}</strong>
              <span className="comparison-note">{formatCurrency(summary.monthCommissionAccrued)} commission</span>
            </article>
            <article className="comparison-card">
              <span className="comparison-label">{summary.previousMonthLabel}</span>
              <strong className="comparison-value">{formatCurrency(summary.previousMonthRevenue)}</strong>
              <span className="comparison-note">{formatCurrency(summary.previousMonthCommissionAccrued)} commission</span>
            </article>
          </div>

          <div className="stack" style={{ marginTop: 16 }}>
            <div className="list-row">
              <div>
                <strong>Revenue change</strong>
                <div className="eyebrow">Current vs previous month</div>
              </div>
              <strong className={getDeltaClass(revenueDelta)}>{formatDelta(revenueDelta)}</strong>
            </div>
            <div className="list-row">
              <div>
                <strong>Commission change</strong>
                <div className="eyebrow">Movement across two months</div>
              </div>
              <strong className={getDeltaClass(commissionDelta)}>{formatDelta(commissionDelta)}</strong>
            </div>
            <div className="list-row">
              <div>
                <strong>{isStaff ? 'Lifetime commission' : 'All-time commission'}</strong>
                <div className="eyebrow">Running total from recorded services</div>
              </div>
              <strong>{formatCurrency(summary.lifetimeCommission)}</strong>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>{isStaff ? 'Your month' : 'Top earner insight'}</h2>
              <p className="panel-copy">
                {isStaff
                  ? 'Your numbers, clients, and earnings.'
                  : 'Who is leading the floor this month.'}
              </p>
            </div>
          </div>

          {isStaff && staffMetrics ? (
            <div className="stack">
              <div className="list-row">
                <div>
                  <strong>Clients this month</strong>
                  <div className="eyebrow">Unique customers handled</div>
                </div>
                <strong>{staffMetrics.monthClients}</strong>
              </div>
              <div className="list-row">
                <div>
                  <strong>Clients today</strong>
                  <div className="eyebrow">Served in current shift</div>
                </div>
                <strong>{staffMetrics.todayClients}</strong>
              </div>
              <div className="list-row">
                <div>
                  <strong>Month commission</strong>
                  <div className="eyebrow">Earned so far this month</div>
                </div>
                <strong className="trend-positive">{formatCurrency(staffMetrics.monthCommission)}</strong>
              </div>
              <div className="list-row">
                <div>
                  <strong>Lifetime income</strong>
                  <div className="eyebrow">Total value of recorded services</div>
                </div>
                <strong>{formatCurrency(summary.lifetimeRevenue)}</strong>
              </div>
            </div>
          ) : (
            <div className="stack">
              <div className="list-row">
                <div>
                  <strong>{summary.highestEarner?.staffName ?? 'No staff data yet'}</strong>
                  <div className="eyebrow">Top revenue contributor</div>
                </div>
                <strong>{formatCurrency(summary.highestEarner?.totalRevenue ?? 0)}</strong>
              </div>
              <div className="list-row">
                <div>
                  <strong>Top earner commission</strong>
                  <div className="eyebrow">Attached commission</div>
                </div>
                <strong>{formatCurrency(summary.highestEarner?.totalCommission ?? 0)}</strong>
              </div>
              <div className="list-row">
                <div>
                  <strong>Net profit</strong>
                  <div className="eyebrow">After expenses, costs, commissions</div>
                </div>
                <strong className="trend-positive">{formatCurrency(summary.monthNetProfit)}</strong>
              </div>
              <div className="list-row">
                <div>
                  <strong>Total income earned</strong>
                  <div className="eyebrow">All recorded service income</div>
                </div>
                <strong>{formatCurrency(summary.lifetimeRevenue)}</strong>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Monthly trend</h2>
            <p className="panel-copy">
              Revenue and commission history across the latest six months for {isStaff ? 'your work' : 'the shop'}.
            </p>
          </div>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Month</th>
              <th>Revenue</th>
              <th>Commission</th>
              <th>Services</th>
              <th>Clients</th>
            </tr>
          </thead>
          <tbody>
            {summary.monthlyTrend.map((row) => (
              <tr key={row.monthKey}>
                <td><strong>{row.monthLabel}</strong></td>
                <td>{formatCurrency(row.revenue)}</td>
                <td>{formatCurrency(row.commission)}</td>
                <td>{row.services}</td>
                <td>{row.clients}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid-two">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>{isStaff ? 'Your reach' : 'Staff ranking'}</h2>
              <p className="panel-copy">
                {isStaff
                  ? 'Client count and service volume.'
                  : 'Revenue per staff member.'}
              </p>
            </div>
          </div>

          <div className="stack">
            {summary.topStaff.map((member) => (
              <div key={member.staffId} className="list-row">
                <div>
                  <strong>{member.staffName}</strong>
                  <div className="eyebrow">
                    {member.totalServices} services / {member.clientCount} clients
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <strong>{formatCurrency(member.totalRevenue)}</strong>
                  <div className="eyebrow">{formatCurrency(member.totalCommission)} commission</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>{isStaff ? 'At a glance' : 'Financial posture'}</h2>
              <p className="panel-copy">
                {isStaff
                  ? 'Your money and client activity.'
                  : 'Net profit after all outflows.'}
              </p>
            </div>
          </div>

          <div className="stack">
            <div className="list-row">
              <div>
                <strong>{isStaff ? 'Clients this month' : 'Expenses this month'}</strong>
                <div className="eyebrow">{isStaff ? 'Unique customers handled' : 'Operating outflow'}</div>
              </div>
              <strong>{isStaff && staffMetrics ? staffMetrics.monthClients : formatCurrency(summary.monthExpenses)}</strong>
            </div>
            <div className="list-row">
              <div>
                <strong>{isStaff ? 'Clients today' : 'Product costs'}</strong>
                <div className="eyebrow">{isStaff ? "Today's customers" : 'Service entry usage'}</div>
              </div>
              <strong>
                {isStaff && staffMetrics ? staffMetrics.todayClients : formatCurrency(summary.monthProductCosts)}
              </strong>
            </div>
            <div className="list-row">
              <div>
                <strong>{isStaff ? 'Month earnings' : 'Net profit'}</strong>
                <div className="eyebrow">{isStaff ? 'Commission accrued' : 'After all outflows'}</div>
              </div>
              <strong className="trend-positive">
                {isStaff && staffMetrics
                  ? formatCurrency(staffMetrics.monthCommission)
                  : formatCurrency(summary.monthNetProfit)}
              </strong>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Recent services</h2>
            <p className="panel-copy">Latest completed services.</p>
          </div>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Service</th>
              <th>Staff</th>
              <th>Commission</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {summary.recentServices.map((record) => (
              <tr key={record.id}>
                <td>{record.customerName}</td>
                <td>{record.serviceName}</td>
                <td>{record.staffName}</td>
                <td>{formatCurrency(record.commission)}</td>
                <td>{formatDateTime(record.performedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
