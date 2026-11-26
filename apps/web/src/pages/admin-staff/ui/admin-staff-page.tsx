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
      {update.error ? <Alert>{update.error.message}</Alert> : null}
      <QueryState query={staff}>
        {({ items }) => (
          <Table caption="Staff" headers={['Name', 'Role', 'State', 'Actions']}>
            {items.map((member) => (
              <tr key={member.id}>
                <td>
                  {member.fullName}
                  <br />
                  <span className="text-slate-500">{member.email}</span>
                </td>
                <td>{member.role}</td>
                <td>{member.disabled ? 'Disabled' : 'Active'}</td>
                <td>
                  {member.role === 'admin' ? null : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
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
                        onClick={() => {
                          update.mutate({ id: member.id, data: { disabled: !member.disabled } });
                        }}
                      >
                        {member.disabled ? 'Enable' : 'Disable'}
                      </Button>
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
