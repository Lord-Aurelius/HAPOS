import { formatWorkedDuration } from '@/server/commerce/attendance';
import {
  rotateAttendanceTerminalAction,
  setAttendanceTerminalActiveAction,
} from '@/server/actions/attendance';
import { requireSession } from '@/server/auth/demo-session';
import {
  listAttendanceRecordsByTenant,
  listAttendanceTerminalsByTenant,
  listUsersByTenant,
} from '@/server/store';

type AttendancePageProps = {
  searchParams: Promise<{
    date?: string;
    employeeId?: string;
    status?: string;
    success?: string;
    error?: string;
    showTerminal?: string;
    showToken?: string;
  }>;
};

function getMessage(params: { success?: string; error?: string }) {
  if (params.success === 'terminal-activated') {
    return 'Attendance terminal activated.';
  }
  if (params.success === 'terminal-revoked') {
    return 'Attendance terminal revoked. Its QR code no longer resolves.';
  }
  if (params.error) {
    return `Attendance action failed (${params.error}).`;
  }
  return null;
}

export default async function AttendanceAdminPage({ searchParams }: AttendancePageProps) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return null;
  }
  const tenant = session.tenant;

  const params = await searchParams;
  const [terminals, records, users] = await Promise.all([
    listAttendanceTerminalsByTenant(tenant.id),
    listAttendanceRecordsByTenant(tenant.id, {
      attendanceDate: params.date || undefined,
      employeeId: params.employeeId || undefined,
      status: params.status || undefined,
    }),
    listUsersByTenant(tenant.id),
  ]);
  const terminal = terminals[0] ?? null;
  const employees = users.filter((user) => user.role === 'staff' || user.role === 'shop_admin');
  const feedback = getMessage(params);
  const oneTimeToken = params.showTerminal && params.showToken ? params.showToken : null;
  const oneTimeReference = params.showTerminal ?? null;
  const qrBaseHref =
    terminal && oneTimeToken && oneTimeReference
      ? `/api/v1/admin/tenants/${tenant.id}/attendance-qr?reference=${encodeURIComponent(oneTimeReference)}&token=${encodeURIComponent(oneTimeToken)}`
      : null;

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Staff attendance</p>
        <h1 className="hero-title">Who is in the shop, and for how long.</h1>
        <p className="hero-subtitle">
          One QR per shop opens the attendance terminal. Employees confirm their identity with their
          employee number — the QR alone grants no privileges. Timestamps are recorded by the server.
        </p>
      </section>

      {feedback ? (
        <section className="panel">
          <span className="pill">{feedback}</span>
        </section>
      ) : null}

      <section className="grid-two">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Attendance terminal QR</h2>
              <p className="panel-copy">
                {terminal
                  ? `Terminal ${terminal.reference} · ${terminal.isActive ? 'ACTIVE' : 'REVOKED'}${terminal.revokedAt ? ` since ${terminal.revokedAt.slice(0, 10)}` : ''}`
                  : 'No terminal provisioned yet.'}
              </p>
              <p className="panel-copy">
                Printing issues a fresh code and immediately invalidates any previously printed
                copies — the bearer is never stored and cannot be recovered, so print at once.
              </p>
            </div>
          </div>

          {qrBaseHref ? (
            <div className="stack">
              <p className="panel-copy">
                Fresh QR generated. Print or download it now — it cannot be shown again afterwards.
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${qrBaseHref}&format=svg`} alt="Attendance terminal QR code" style={{ maxWidth: 320 }} />
              <div className="hero-actions" style={{ marginTop: 0 }}>
                <a className="button secondary" href={`${qrBaseHref}&format=svg&download=1`}>
                  Download SVG
                </a>
                <a className="button secondary" href={`${qrBaseHref}&format=png&download=1`}>
                  Download PNG
                </a>
              </div>
            </div>
          ) : (
            <p className="panel-copy">
              {terminal?.isActive
                ? 'Print a fresh QR code below. Previously printed copies stop working immediately.'
                : 'Generate a QR code below to activate this terminal.'}
            </p>
          )}

          <div className="hero-actions">
            <form action={rotateAttendanceTerminalAction}>
              <button type="submit" className="button">
                {terminal ? 'Print / Reissue QR' : 'Generate QR'}
              </button>
            </form>
            {terminal?.isActive ? (
              <form action={setAttendanceTerminalActiveAction}>
                <input type="hidden" name="isActive" value="false" />
                <button type="submit" className="button secondary">
                  Delete / Revoke
                </button>
              </form>
            ) : terminal ? (
              <form action={setAttendanceTerminalActiveAction}>
                <input type="hidden" name="isActive" value="true" />
                <button type="submit" className="button secondary">
                  Reactivate (then Print / Reissue)
                </button>
              </form>
            ) : null}
          </div>
          <p className="panel-copy" style={{ marginTop: 8 }}>
            Lifecycle: ACTIVE (QR works) → REVOKED (QR dead, history kept). Deleting never removes
            records — it only revokes the QR.
          </p>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Filter attendance</h2>
              <p className="panel-copy">Narrow by date, employee, or status.</p>
            </div>
          </div>
          <form method="get" action="/app/attendance" className="field-grid">
            <div className="field">
              <label htmlFor="date">Date</label>
              <input id="date" name="date" type="date" defaultValue={params.date ?? ''} />
            </div>
            <div className="field">
              <label htmlFor="employeeId">Employee</label>
              <select id="employeeId" name="employeeId" defaultValue={params.employeeId ?? ''}>
                <option value="">All employees</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue={params.status ?? ''}>
                <option value="">All statuses</option>
                <option value="CHECKED_IN">Checked in</option>
                <option value="CHECKED_OUT">Checked out</option>
              </select>
            </div>
            <div className="hero-actions">
              <button type="submit" className="button secondary">
                Apply filters
              </button>
              <a className="button secondary" href="/app/attendance">
                Today
              </a>
            </div>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Attendance records ({records.length})</h2>
            <p className="panel-copy">
              Corrections are intentionally unavailable here — records are append-only until the
              audited correction workflow lands in a later phase.
            </p>
          </div>
        </div>
        <div className="stack">
          {records.length > 0 ? (
            records.map((record) => (
              <div key={record.id} className="list-row">
                <div>
                  <strong>{record.employeeName ?? 'Employee'}</strong>
                  <div className="eyebrow">
                    {record.employeeNumberSnapshot} · {record.attendanceDate} · {record.status}
                  </div>
                  <div className="eyebrow">
                    in {record.checkInAt.slice(0, 19).replace('T', ' ')} · out{' '}
                    {record.checkOutAt ? record.checkOutAt.slice(0, 19).replace('T', ' ') : '—'} ·{' '}
                    {formatWorkedDuration(record.checkInAt, record.checkOutAt)}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="eyebrow">No attendance records match these filters.</div>
          )}
        </div>
      </section>
    </>
  );
}
