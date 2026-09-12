import { punchAttendance } from '@/app/api/v1/attendance/terminal-ops';

export async function POST(request: Request) {
  return punchAttendance(request, 'out');
}
