'use client';

import { RequireRole } from '@/entities/session';
import { GatewayForm } from '@/features/manage-staff';
import { useGatewayGet } from '@/shared/api';
import { Card, Page, QueryState } from '@/shared/ui';

const Gateway = () => {
  const config = useGatewayGet();
  return (
    <Page title="Payment system">
      <QueryState query={config}>
        {(data) => (
          <Card>
            <p>
              {data.configured
                ? `Connected. The key ends in ${data.keyLast4 ?? ''}.`
                : 'Not connected yet.'}
            </p>
            <GatewayForm key={data.updatedAt ?? 'new'} baseUrl={data.baseUrl ?? ''} />
          </Card>
        )}
      </QueryState>
    </Page>
  );
};

export const AdminGatewayPage = () => (
  <RequireRole role="admin">
    <Gateway />
  </RequireRole>
);
