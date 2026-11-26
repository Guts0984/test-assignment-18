'use client';

import { useRouter } from 'next/navigation';
import { awaitsPayment, Countdown, STATUS_LABELS } from '@/entities/enrollment';
import { RequireRole } from '@/entities/session';
import { CancelEnrollment } from '@/features/cancel-enrollment';
import { PaymentPanel } from '@/features/checkout';
import { TransferEnrollment } from '@/features/transfer-enrollment';
import { useEnrollmentsGet } from '@/shared/api';
import { formatDay, formatMoney, useRouteParam, useSearchText } from '@/shared/lib';
import { Alert, Card, Page, QueryState } from '@/shared/ui';

const Detail = () => {
  const id = useRouteParam('id');
  const router = useRouter();
  const promoProblem = new URLSearchParams(useSearchText()).get('promo');
  // While payment is awaited, the status is polled: the notification arrives in the background.
  const enrollment = useEnrollmentsGet(id, {
    query: {
      refetchInterval: (query) =>
        query.state.data && awaitsPayment(query.state.data.status) ? 2_000 : 15_000,
    },
  });
  return (
    <Page title={enrollment.data?.courseTitle ?? 'Enrollment'}>
      <QueryState query={enrollment}>
        {(data) => (
          <>
            <Card label="Status">
              <p className="text-lg" data-testid="enrollment-status">
                {STATUS_LABELS[data.status]}
              </p>
              <p>Starts {formatDay(data.startDate)}</p>
              <p>
                Price {formatMoney(data.priceMinor, data.currency)}
                {data.priceMinor < data.listPriceMinor
                  ? ` (instead of ${formatMoney(data.listPriceMinor, data.currency)})`
                  : ''}
                {data.paidMinor > 0 ? ` · paid ${formatMoney(data.paidMinor, data.currency)}` : ''}
              </p>
            </Card>
            {awaitsPayment(data.status) && data.holdExpiresAt ? (
              <Card label="Payment">
                {promoProblem && !data.promoCode ? (
                  <Alert tone="info">The promo code was not applied: {promoProblem}</Alert>
                ) : null}
                <Countdown
                  deadline={data.holdExpiresAt}
                  serverNow={data.serverNow}
                  receivedAt={enrollment.dataUpdatedAt}
                  onExpired={() => {
                    void enrollment.refetch();
                  }}
                />
                <PaymentPanel
                  enrollmentId={data.id}
                  promoCode={data.promoCode}
                  promoAllowed={data.transferFromId === null}
                />
                <CancelEnrollment enrollmentId={data.id} />
              </Card>
            ) : null}
            {data.status === 'paid' ? (
              <Card label="Changes">
                <TransferEnrollment
                  enrollmentId={data.id}
                  onMoved={(next) => {
                    router.push(`/account/enrollments/${next}`);
                  }}
                />
                <CancelEnrollment enrollmentId={data.id} />
              </Card>
            ) : null}
          </>
        )}
      </QueryState>
    </Page>
  );
};

export const EnrollmentPage = () => (
  <RequireRole role="student">
    <Detail />
  </RequireRole>
);
