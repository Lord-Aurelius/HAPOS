import { NextResponse } from 'next/server';

import { AttendanceError } from '@/server/commerce/attendance';
import { attendanceRateLimitedResponse, checkAttendanceRateLimit } from '@/server/auth/attendance-limit';
import { readStore, updateStore } from '@/server/store';
import type { StoreState } from '@/server/store/types';
import {
  checkInEmployee,
  checkOutEmployee,
  resolveTerminalContext,
  verifyTerminalToken,
  type AttendanceStore,
} from '@/server/commerce/attendance-store';

export function attendanceErrorResponse(error: unknown) {
  if (error instanceof AttendanceError) {
    const status =
      error.code === 'invalid-terminal'
        ? 404
        : error.code === 'terminal-revoked'
          ? 410
          : error.code === 'unknown-employee'
            ? 404
            : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  throw error;
}

export function attendanceStoreOf(store: StoreState): AttendanceStore {
  return store as unknown as AttendanceStore;
}

export type PunchBody = {
  reference?: unknown;
  token?: unknown;
  employeeNumber?: unknown;
};

/** Shared check-in/check-out handler (server timestamps, token verified). */
export async function punchAttendance(request: Request, action: 'in' | 'out') {
  const body = (await request.json().catch(() => null)) as PunchBody | null;
  const reference = typeof body?.reference === 'string' ? body.reference.trim() : '';
  const token = typeof body?.token === 'string' ? body.token : '';
  const employeeNumber = typeof body?.employeeNumber === 'string' ? body.employeeNumber : '';
  if (!reference || !token || !employeeNumber) {
    return NextResponse.json(
      { error: 'reference, token and employeeNumber are required.', code: 'invalid-employee-number' },
      { status: 400 },
    );
  }
  if (!checkAttendanceRateLimit(reference)) {
    return attendanceRateLimitedResponse();
  }

  try {
    const record = await updateStore((store) => {
      const { tenantId } = verifyTerminalToken(attendanceStoreOf(store), reference, token);
      const tenant = store.tenants.find((item) => item.id === tenantId) ?? null;
      if (!tenant) {
        throw new AttendanceError('invalid-terminal', 'This attendance terminal is not recognized.');
      }
      const input = {
        tenantId,
        employeeNumber,
        terminalReference: reference,
        timeZone: tenant.timezone || 'UTC',
      };
      return action === 'in'
        ? checkInEmployee(attendanceStoreOf(store), input)
        : checkOutEmployee(attendanceStoreOf(store), input);
    });

    const store = await readStore();
    const employeeName = store.users.find((item) => item.id === record.employeeId)?.fullName ?? null;
    return NextResponse.json({ ...record, employeeName }, { status: action === 'in' ? 201 : 200 });
  } catch (error) {
    return attendanceErrorResponse(error);
  }
}

export async function resolveTerminalReference(reference: string) {
  if (!checkAttendanceRateLimit(reference)) {
    return attendanceRateLimitedResponse();
  }
  try {
    const store = await readStore();
    const context = resolveTerminalContext(attendanceStoreOf(store), reference);
    const tenant = store.tenants.find((item) => item.id === context.tenantId) ?? null;
    return NextResponse.json({ reference: context.reference, tenantName: tenant?.name ?? null });
  } catch (error) {
    return attendanceErrorResponse(error);
  }
}
