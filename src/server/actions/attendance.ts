'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireSession } from '@/server/auth/demo-session';
import { createRateLimiter } from '@/server/auth/rate-limit';
import { AttendanceError, assertValidEmployeeNumber, normalizeEmployeeNumber } from '@/server/commerce/attendance';
import {
  checkInEmployee,
  checkOutEmployee,
  identifyEmployee,
  rotateTerminal,
  setTerminalActive,
  verifyTerminalToken,
  type AttendanceStore,
} from '@/server/commerce/attendance-store';
import { readStore, updateStore } from '@/server/store';
import type { StoreState } from '@/server/store/types';

function formString(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

function attendanceStoreOf(store: StoreState): AttendanceStore {
  return store as unknown as AttendanceStore;
}

// Public terminal throttle: 30 attempts per 10 minutes per terminal. This is
// enumeration friction for employee numbers, not authentication.
const terminalLimiter = createRateLimiter({ maxAttempts: 30, windowMs: 10 * 60 * 1000 });

function checkTerminalRateLimit(reference: string) {
  const decision = terminalLimiter.attempt(`attendance::${reference.toLowerCase()}`);
  if (!decision.allowed) {
    redirect(`/attendance/${reference}?error=rate-limited`);
  }
}

function terminalErrorRedirect(reference: string, error: unknown): never {
  if (error instanceof AttendanceError) {
    redirect(`/attendance/${reference}?error=${error.code}`);
  }
  throw error;
}

export async function identifyAttendanceAction(formData: FormData) {
  const reference = formString(formData, 'terminalRef');
  const token = formString(formData, 'token');
  const employeeNumber = formString(formData, 'employeeNumber');
  checkTerminalRateLimit(reference);

  try {
    const store = await readStore();
    const { tenantId } = verifyTerminalToken(attendanceStoreOf(store), reference, token);
    const identified = identifyEmployee(attendanceStoreOf(store), tenantId, employeeNumber);
    redirect(`/attendance/${reference}?k=${encodeURIComponent(token)}&number=${encodeURIComponent(identified.employeeNumber)}`);
  } catch (error) {
    terminalErrorRedirect(reference || 'unknown', error);
  }
}

export async function checkInAttendanceAction(formData: FormData) {
  const reference = formString(formData, 'terminalRef');
  const token = formString(formData, 'token');
  const employeeNumber = formString(formData, 'employeeNumber');
  checkTerminalRateLimit(reference);

  try {
    const result = await updateStore((store) => {
      const { tenantId } = verifyTerminalToken(attendanceStoreOf(store), reference, token);
      const tenant = store.tenants.find((item) => item.id === tenantId) ?? null;
      if (!tenant) {
        throw new AttendanceError('invalid-terminal', 'This attendance terminal is not recognized.');
      }
      const record = checkInEmployee(
        attendanceStoreOf(store),
        {
          tenantId,
          employeeNumber,
          terminalReference: reference,
          timeZone: tenant.timezone || 'UTC',
        },
      );
      return { recordId: record.id, number: record.employeeNumberSnapshot };
    });
    revalidatePath(`/attendance/${reference}`);
    redirect(
      `/attendance/${reference}?k=${encodeURIComponent(token)}&number=${encodeURIComponent(result.number)}&done=${result.recordId}&action=in`,
    );
  } catch (error) {
    terminalErrorRedirect(reference || 'unknown', error);
  }
}

export async function checkOutAttendanceAction(formData: FormData) {
  const reference = formString(formData, 'terminalRef');
  const token = formString(formData, 'token');
  const employeeNumber = formString(formData, 'employeeNumber');
  checkTerminalRateLimit(reference);

  try {
    const result = await updateStore((store) => {
      const { tenantId } = verifyTerminalToken(attendanceStoreOf(store), reference, token);
      const tenant = store.tenants.find((item) => item.id === tenantId) ?? null;
      if (!tenant) {
        throw new AttendanceError('invalid-terminal', 'This attendance terminal is not recognized.');
      }
      const record = checkOutEmployee(
        attendanceStoreOf(store),
        {
          tenantId,
          employeeNumber,
          terminalReference: reference,
          timeZone: tenant.timezone || 'UTC',
        },
      );
      return { recordId: record.id, number: record.employeeNumberSnapshot };
    });
    revalidatePath(`/attendance/${reference}`);
    redirect(
      `/attendance/${reference}?k=${encodeURIComponent(token)}&number=${encodeURIComponent(result.number)}&done=${result.recordId}&action=out`,
    );
  } catch (error) {
    terminalErrorRedirect(reference || 'unknown', error);
  }
}

export async function rotateAttendanceTerminalAction() {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    redirect('/super/tenants');
  }

  const result = await updateStore((store) => {
    const tenants = store.tenants;
    const tenant = tenants.find((item) => item.id === session.tenant!.id) ?? null;
    if (!tenant) {
      throw new AttendanceError('invalid-terminal', 'Shop not found.');
    }
    const rotated = rotateTerminal(
      attendanceStoreOf(store),
      { tenantId: tenant.id, createdBy: session.user.id, shopSlug: tenant.slug },
    );
    return { reference: rotated.terminal.reference, token: rotated.token };
  });

  revalidatePath('/app/attendance');
  // One-time token display (standard API-key ceremony): the token below grants
  // terminal check-in/out context only — never sessions or admin data.
  redirect(`/app/attendance?showTerminal=${result.reference}&showToken=${result.token}`);
}

export async function setAttendanceTerminalActiveAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    redirect('/super/tenants');
  }

  const isActive = formString(formData, 'isActive') === 'true';
  await updateStore((store) => {
    setTerminalActive(attendanceStoreOf(store), { tenantId: session.tenant!.id, isActive });
  });

  revalidatePath('/app/attendance');
  redirect(`/app/attendance?success=${isActive ? 'terminal-activated' : 'terminal-revoked'}`);
}

export async function setEmployeeNumberAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    redirect('/super/tenants');
  }

  const userId = formString(formData, 'userId');
  const rawNumber = formString(formData, 'employeeNumber');
  const redirectBase =
    session.user.role === 'super_admin' ? '/super/tenants' : '/app/settings/staff';

  try {
    const normalized = rawNumber ? assertValidEmployeeNumber(normalizeEmployeeNumber(rawNumber)) : null;
    await updateStore((store) => {
      const user = store.users.find((item) => item.id === userId) ?? null;
      if (!user || (session.user.role !== 'super_admin' && user.tenantId !== session.tenant!.id)) {
        throw new AttendanceError('unknown-employee', 'Employee not found for this shop.');
      }
      if (user.role === 'super_admin') {
        throw new AttendanceError('unknown-employee', 'Employee not found for this shop.');
      }
      if (normalized) {
        const clash = store.users.some(
          (item) =>
            item.id !== user.id &&
            item.tenantId === user.tenantId &&
            (item.employeeNumber ?? '').toUpperCase() === normalized,
        );
        if (clash) {
          throw new AttendanceError('invalid-employee-number', 'Another employee already uses that number.');
        }
      }
      user.employeeNumber = normalized;
      user.updatedAt = new Date().toISOString();
    });
  } catch (error) {
    if (error instanceof AttendanceError) {
      redirect(`${redirectBase}?error=${error.code}`);
    }
    throw error;
  }

  revalidatePath('/app/settings/staff');
  revalidatePath('/super/tenants');
  redirect(`${redirectBase}?success=employee-number-saved`);
}
