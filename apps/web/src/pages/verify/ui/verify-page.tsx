'use client';

import { useRouteParam } from '@/shared/lib';
import { useCertificatesVerify } from '@/shared/api';
import { Alert, Card, Page, QueryState } from '@/shared/ui';

export const VerifyPage = () => {
  const token = useRouteParam('token');
  const certificate = useCertificatesVerify(token);
  return (
    <Page title="Certificate check">
      {certificate.error ? (
        <Alert>This link does not confirm any certificate.</Alert>
      ) : (
        <QueryState query={certificate}>
          {(data) => (
            <Card>
              <Alert tone="success">This certificate is genuine.</Alert>
              <p className="text-xl font-semibold">{data.studentName}</p>
              <p>{data.courseTitle}</p>
              <p>
                {data.schoolName} · No. {data.number} · {data.issuedAt.slice(0, 10)}
              </p>
            </Card>
          )}
        </QueryState>
      )}
    </Page>
  );
};
