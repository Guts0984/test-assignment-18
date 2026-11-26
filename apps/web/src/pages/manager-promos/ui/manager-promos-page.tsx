'use client';

import { RequireRole } from '@/entities/session';
import { CreatePromo } from '@/features/manage-promos';
import { usePromosList } from '@/shared/api';
import { formatMoney, pageFrom, useUrlQuery } from '@/shared/lib';
import { Card, Page, Pagination, QueryState, Table } from '@/shared/ui';

const KEYS = ['page'] as const;

const Promos = () => {
  const [query, setQuery] = useUrlQuery(KEYS);
  const promos = usePromosList({ page: pageFrom(query.page) });
  return (
    <Page title="Promo codes">
      <Card label="New promo code">
        <CreatePromo />
      </Card>
      <QueryState query={promos}>
        {(data) => (
          <>
            <Table caption="Promo codes" headers={['Code', 'Discount', 'Used', 'Valid']}>
              {data.items.map((promo) => (
                <tr key={promo.id}>
                  <td>{promo.code}</td>
                  <td>
                    {promo.discount.kind === 'percent'
                      ? `${promo.discount.percent}%`
                      : formatMoney(promo.discount.amountMinor, promo.discount.currency)}
                  </td>
                  <td>
                    {promo.usedCount} used, {promo.reservedCount} reserved, of {promo.maxUses}
                  </td>
                  <td>
                    {promo.validFrom.slice(0, 10)} – {promo.validUntil.slice(0, 10)}
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination
              {...data}
              onChange={(page) => {
                setQuery({ page });
              }}
            />
          </>
        )}
      </QueryState>
    </Page>
  );
};

export const ManagerPromosPage = () => (
  <RequireRole role="manager">
    <Promos />
  </RequireRole>
);
