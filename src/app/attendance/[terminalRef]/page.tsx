import { AttendanceError, formatWorkedDuration } from '@/server/commerce/attendance';
import {
  checkInAttendanceAction,
  checkOutAttendanceAction,
  identifyAttendanceAction,
} from '@/server/actions/attendance';
import { identifyEmployee, verifyTerminalToken, type AttendanceStore } from '@/server/commerce/attendance-store';
import { readStore } from '@/server/store';
import type { StoreState } from '@/server/store/types';

type TerminalPageProps = {
  params: Promise<{ terminalRef: string }>;
  searchParams: Promise<{ k?: string; number?: string; done?: string; action?: string; error?: string }>;
};

function getErrorMessage(error?: string) {
  const messages: Record<string, string> = {
    'invalid-terminal': 'This attendance terminal is not recognized or has been revoked.',
    'terminal-revoked': 'This attendance terminal has been revoked. Ask an admin to reactivate it.',
    'invalid-employee-number': 'Enter a valid employee number (letters, numbers and hyphens, 3–16 characters).',
    'unknown-employee': 'No employee with that number in this shop.',
    'inactive-employee': 'That employee record is inactive. Ask an admin for help.',
    'already-checked-in': 'Already checked in. Check out first.',
    'not-checked-in': 'Not checked in yet. Check in first.',
    'rate-limited': 'Too many attempts. Wait a few minutes and try again.',
  };
  return (error && messages[error]) || null;
}

export default async function AttendanceTerminalPage({ params, searchParams }: TerminalPageProps) {
  const { terminalRef } = await params;
  const query = await searchParams;
  const token = query.k ?? '';
  const number = query.number ?? '';
  const baseErrorMessage = getErrorMessage(query.error);
  let identifyErrorMessage: string | null = null;

  let tenantName: string | null = null;
  let terminalValid = false;
  let identified: { fullName: string; employeeNumber: string; openRecordId: string | null; openCheckInAt: string | null } | null = null;
  let receipt: {
    employeeName: string | null;
    employeeNumberSnapshot: string;
    checkInAt: string;
    checkOutAt: string | null;
    status: string;
  } | null = null;

  if (token) {
    try {
      const store = (await readStore()) as unknown as AttendanceStore & Pick<StoreState, 'tenants'>;
      const context = verifyTerminalToken(store, terminalRef, token);
      const fullStore = (await readStore()) as unknown as StoreState;
      tenantName = fullStore.tenants.find((item) => item.id === context.tenantId)?.name ?? null;
      terminalValid = true;

      if (number) {
        try {
          identified = identifyEmployee(store, context.tenantId, number);
        } catch (error) {
          if (!(error instanceof AttendanceError)) {
            throw error;
          }
          identified = null;
          identifyErrorMessage = getErrorMessage(error.code);
        }
      }

      if (query.done) {
        const record = (fullStore.attendanceRecords ?? []).find(
          (item) => item.id === query.done && item.tenantId === context.tenantId,
        );
        if (record) {
          receipt = {
            employeeName: fullStore.users.find((item) => item.id === record.employeeId)?.fullName ?? null,
            employeeNumberSnapshot: record.employeeNumberSnapshot,
            checkInAt: record.checkInAt,
            checkOutAt: record.checkOutAt ?? null,
            status: record.status,
          };
        }
      }
    } catch {
      terminalValid = false;
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card" style={{ maxWidth: 480, margin: '48px auto' }}>
        <p className="hero-kicker">Staff attendance{tenantName ? ` · ${tenantName}` : ''}</p>
        <h1 className="section-title">Attendance terminal</h1>

        {baseErrorMessage || identifyErrorMessage ? (
          <p className="pill" style={{ marginTop: 12, background: 'rgba(160, 60, 46, 0.12)', color: 'var(--danger)' }}>
            {baseErrorMessage ?? identifyErrorMessage}
          </p>
        ) : null}

        {!token || !terminalValid ? (
          <p className="muted" style={{ marginTop: 16 }}>
            This terminal link is missing or invalid. Scan the shop&apos;s attendance QR code to begin.
          </p>
        ) : receipt ? (
          <div className="stack" style={{ marginTop: 16 }}>
            <h2>{receipt.status === 'CHECKED_OUT' ? 'Checked out' : 'Checked in'}</h2>
            <div className="list-row">
              <div>
                <strong>{receipt.employeeName ?? 'Employee'}</strong>
                <div className="eyebrow">{receipt.employeeNumberSnapshot}</div>
              </div>
            </div>
            <div className="list-row">
              <div>
                <strong>Check-in</strong>
                <div className="eyebrow">{receipt.checkInAt.slice(0, 19).replace('T', ' ')}</div>
              </div>
              <div>
                <strong>Check-out</strong>
                <div className="eyebrow">
                  {receipt.checkOutAt ? receipt.checkOutAt.slice(0, 19).replace('T', ' ') : '—'}
                </div>
              </div>
            </div>
            <p className="muted">Hours: {formatWorkedDuration(receipt.checkInAt, receipt.checkOutAt)}</p>
            <a className="button secondary" href={`/attendance/${terminalRef}?k=${encodeURIComponent(token)}`}>
              Back to terminal
            </a>
          </div>
        ) : !identified ? (
          <form action={identifyAttendanceAction} className="field-grid" style={{ marginTop: 16 }}>
            <input type="hidden" name="terminalRef" value={terminalRef} />
            <input type="hidden" name="token" value={token} />
            <div className="field">
              <label htmlFor="employeeNumber">Employee number</label>
              <input id="employeeNumber" name="employeeNumber" placeholder="EMP-0042" autoComplete="off" />
            </div>
            <div className="hero-actions">
              <button type="submit" className="button">
                Continue
              </button>
            </div>
          </form>
        ) : (
          <div className="stack" style={{ marginTop: 16 }}>
            <div className="list-row">
              <div>
                <strong>{identified.fullName}</strong>
                <div className="eyebrow">{identified.employeeNumber}</div>
              </div>
              <div className="eyebrow">{identified.openRecordId ? 'Checked in' : 'Not checked in'}</div>
            </div>
            {identified.openCheckInAt ? (
              <p className="muted">Open since {identified.openCheckInAt.slice(0, 19).replace('T', ' ')}</p>
            ) : null}
            {identified.openRecordId ? (
              <form action={checkOutAttendanceAction} className="field-grid">
                <input type="hidden" name="terminalRef" value={terminalRef} />
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="employeeNumber" value={identified.employeeNumber} />
                <div className="hero-actions" style={{ marginTop: 0 }}>
                  <button type="submit" className="button">
                    Check out
                  </button>
                </div>
              </form>
            ) : (
              <form action={checkInAttendanceAction} className="field-grid">
                <input type="hidden" name="terminalRef" value={terminalRef} />
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="employeeNumber" value={identified.employeeNumber} />
                <div className="hero-actions" style={{ marginTop: 0 }}>
                  <button type="submit" className="button">
                    Check in
                  </button>
                </div>
              </form>
            )}
            <a className="button secondary" href={`/attendance/${terminalRef}?k=${encodeURIComponent(token)}`}>
              Use a different number
            </a>
          </div>
        )}
      </section>
    </main>
  );
}
