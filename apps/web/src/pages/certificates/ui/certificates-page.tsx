'use client';

import { RequireRole } from '@/entities/session';
import { useCertificatesList } from '@/shared/api';
import { Card, Page, QueryState } from '@/shared/ui';

const List = () => {
  const certificates = useCertificatesList();
  return (
    <Page title="Certificates">
      <QueryState query={certificates}>
        {({ items }) =>
          items.length === 0 ? (
            <p>
              A certificate appears here after a course ends with enough of the homework accepted.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {items.map((item) => (
                <li key={item.id}>
                  <Card>
                    <h2 className="font-semibold">
                      {item.courseTitle} · No. {item.number}
                    </h2>
                    <a className="underline" href={`/api/certificates/${item.id}/pdf`}>
                      Download PDF
                    </a>
                    <a className="underline" href={item.verifyUrl}>
                      Public verification link
                    </a>
                  </Card>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </Page>
  );
};

export const CertificatesPage = () => (
  <RequireRole role="student">
    <List />
  </RequireRole>
);
