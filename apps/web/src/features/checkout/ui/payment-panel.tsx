'use client';

import { useState } from 'react';
import { useEnrollmentsApplyPromo, useEnrollmentsCheckout } from '@/shared/api';
import { Alert, Button, Input } from '@/shared/ui';

export const PaymentPanel = ({
  enrollmentId,
  promoCode,
  promoAllowed,
}: {
  enrollmentId: string;
  promoCode: string | null;
  promoAllowed: boolean;
}) => {
  const [code, setCode] = useState('');
  const apply = useEnrollmentsApplyPromo();
  const checkout = useEnrollmentsCheckout({
    mutation: {
      onSuccess: ({ payUrl }) => {
        window.location.assign(payUrl);
      },
    },
  });
  return (
    <div className="flex flex-col gap-3">
      {promoCode ? (
        <Alert tone="success">Promo code {promoCode} is applied.</Alert>
      ) : promoAllowed ? (
        <form
          noValidate
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            apply.mutate({ id: enrollmentId, data: { code } });
          }}
        >
          <div className="flex-1">
            <Input
              label="Promo code"
              value={code}
              error={apply.error?.message}
              onChange={(event) => {
                setCode(event.target.value);
              }}
            />
          </div>
          <Button type="submit" variant="secondary" pending={apply.isPending}>
            Apply
          </Button>
        </form>
      ) : null}
      {checkout.error ? <Alert>{checkout.error.message}</Alert> : null}
      <Button
        pending={checkout.isPending || checkout.isSuccess}
        onClick={() => {
          checkout.mutate({ id: enrollmentId });
        }}
      >
        Go to payment
      </Button>
    </div>
  );
};
