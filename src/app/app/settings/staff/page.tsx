import { addUserAction, setUserPasswordAction, setUserStatusAction, updateStaffTermsAction } from '@/server/actions/hapos';
import { requireSession } from '@/server/auth/demo-session';
import { listUsers } from '@/server/services/app-data';
import { listCredentialRecordsForTenant } from '@/server/services/admin-tools';

type StaffSettingsPageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function StaffSettingsPage({ searchParams }: StaffSettingsPageProps) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return null;
  }
  const params = await searchParams;

  const [users, credentials] = await Promise.all([
    listUsers(session.tenant.id),
    listCredentialRecordsForTenant(session.tenant.id),
  ]);

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Staff management</p>
        <h1 className="hero-title">Control who can work, record, and administer.</h1>
        <p className="hero-subtitle">
          Shop admins can onboard staff, disable accounts, and keep role boundaries intact without exposing financial controls to the floor team.
        </p>
      </section>

      {params.success || params.error ? (
        <section className="panel">
          <span className="pill">
            {params.error === 'user-exists'
              ? 'That username or email already exists for this business.'
              : params.success === 'user-added'
                ? 'Employee login created.'
                : params.success === 'user-status'
                  ? 'Employee access updated.'
                  : params.success === 'password-updated'
                    ? 'Password updated.'
                    : params.error === 'password-required'
                      ? 'Enter a password before saving.'
                  : 'Staff settings saved.'}
          </span>
        </section>
      ) : null}

      <section className="grid-two">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Create employee login</h2>
              <p className="panel-copy">Each shop has its own staff and admin credentials, isolated from every other tenant.</p>
            </div>
          </div>

          <form action={addUserAction} className="field-grid">
            <div className="field">
              <label htmlFor="fullName">Full name</label>
              <input id="fullName" name="fullName" required />
            </div>
            <div className="field">
              <label htmlFor="username">Username</label>
              <input id="username" name="username" required />
            </div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" required />
            </div>
            <div className="field">
              <label htmlFor="phone">Phone</label>
              <input id="phone" name="phone" />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" name="password" type="password" required />
            </div>
            <div className="field">
              <label htmlFor="role">Role</label>
              <select id="role" name="role">
                <option value="staff">Staff</option>
                <option value="shop_admin">Shop admin</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="commissionType">Commission type</label>
              <select id="commissionType" name="commissionType">
                <option value="percentage">Percentage</option>
                <option value="fixed">Fixed</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="commissionValue">Commission value</label>
              <input id="commissionValue" name="commissionValue" type="number" min="0" step="1" required />
            </div>
            <div className="field">
              <label htmlFor="commissionNotes">Payment terms / notes</label>
              <textarea id="commissionNotes" name="commissionNotes" />
            </div>
            <div className="hero-actions">
              <button type="submit" className="button">
                Create user
              </button>
            </div>
          </form>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Update staff terms and passwords</h2>
              <p className="panel-copy">Admins define how each employee earns and can immediately reset credentials if recovery is needed.</p>
            </div>
          </div>

          <form action={updateStaffTermsAction} className="field-grid">
            <div className="field">
              <label htmlFor="userId">Employee</label>
              <select id="userId" name="userId">
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="commissionTypeUpdate">Commission type</label>
              <select id="commissionTypeUpdate" name="commissionType">
                <option value="percentage">Percentage</option>
                <option value="fixed">Fixed</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="commissionValueUpdate">Commission value</label>
              <input id="commissionValueUpdate" name="commissionValue" type="number" min="0" step="1" required />
            </div>
            <div className="field">
              <label htmlFor="commissionNotesUpdate">Terms / notes</label>
              <textarea id="commissionNotesUpdate" name="commissionNotes" />
            </div>
            <div className="hero-actions">
              <button type="submit" className="button">
                Save terms
              </button>
            </div>
          </form>

          <form action={setUserPasswordAction} className="field-grid" style={{ marginTop: 20 }}>
            <div className="field">
              <label htmlFor="userIdPassword">Employee</label>
              <select id="userIdPassword" name="userId">
                {credentials.map((user) => (
                  <option key={user.userId} value={user.userId}>
                    {user.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="passwordUpdate">New password</label>
              <input id="passwordUpdate" name="password" type="password" required />
            </div>
            <div className="hero-actions">
              <button type="submit" className="button secondary">
                Reset password
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Shop users</h2>
            <p className="panel-copy">Roles should map directly to your API authorization and database access policies.</p>
          </div>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Email</th>
              <th>Role</th>
              <th>Password status</th>
              <th>Commission</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {credentials.map((user) => (
              <tr key={user.userId}>
                <td>{user.fullName}</td>
                <td>{user.username}</td>
                <td>{user.email}</td>
                <td>{user.role}</td>
                <td>{user.passwordUpdatedAt ? `Updated ${user.passwordUpdatedAt.slice(0, 10)}` : 'Reset required'}</td>
                <td>
                  {user.commissionType === 'fixed'
                    ? `${user.commissionValue ?? 0} fixed`
                    : `${user.commissionValue ?? 0}%`}
                </td>
                <td>
                  <div style={{ display: 'grid', gap: 8 }}>
                    <span>{user.isActive ? 'active' : 'disabled'}</span>
                    <form action={setUserStatusAction}>
                      <input type="hidden" name="userId" value={user.userId} />
                      <input type="hidden" name="redirectTo" value="/app/settings/staff?success=user-status" />
                      <input type="hidden" name="nextStatus" value={user.isActive ? 'inactive' : 'active'} />
                      <button type="submit" className="button secondary" style={{ minHeight: 38 }}>
                        {user.isActive ? 'Disable' : 'Enable'}
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
