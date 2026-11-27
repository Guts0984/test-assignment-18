'use client';

import { RequireRole } from '@/entities/session';
import { CreateStaff } from '@/features/manage-staff';
import { useStaffList, useStaffUpdate } from '@/shared/api';
import { Alert, Button, Card, Page, QueryState, Table } from '@/shared/ui';

const Staff = () => {
  const staff = useStaffList();
  const update = useStaffUpdate();
  return (
    <Page title="Staff">
      <Card label="New employee">
        <CreateStaff />
      </Card>
      <QueryState query={staff}>
        {({ items }) => (
          <Table caption="Staff" headers={['Name', 'Role', 'State', 'Actions']}>
            {items.map((member) => (
              <tr key={member.id} data-testid={`staff-${member.email}`}>
                <td>
                  {member.fullName}
                  <br />
                  <span className="text-slate-500">{member.email}</span>
                </td>
                <td>{member.role}</td>
                <td>{member.disabled ? 'Disabled' : 'Active'}</td>
                <td>
                  {member.role === 'admin' ? null : (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          disabled={member.openCohorts > 0}
                          onClick={() => {
                            update.mutate({
                              id: member.id,
                              data: { role: member.role === 'mentor' ? 'manager' : 'mentor' },
                            });
                          }}
                        >
                          Make {member.role === 'mentor' ? 'manager' : 'mentor'}
                        </Button>
                        <Button
                          variant={member.disabled ? 'secondary' : 'danger'}
                          disabled={!member.disabled && member.openCohorts > 0}
                          onClick={() => {
                            update.mutate({
                              id: member.id,
                              data: { disabled: !member.disabled },
                            });
                          }}
                        >
                          {member.disabled ? 'Enable' : 'Disable'}
                        </Button>
                      </div>
                      {member.openCohorts > 0 ? (
                        <p className="text-sm text-slate-600">
                          Mentors {member.openCohorts} unfinished{' '}
                          {member.openCohorts === 1 ? 'cohort' : 'cohorts'}. A manager has to assign
                          another mentor first.
                        </p>
                      ) : null}
                      {update.error && update.variables.id === member.id ? (
                        <Alert>{update.error.message}</Alert>
                      ) : null}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </QueryState>
    </Page>
  );
};

export const AdminStaffPage = () => (
  <RequireRole role="admin">
    <Staff />
  </RequireRole>
);
