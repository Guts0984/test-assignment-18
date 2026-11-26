'use client';

import { createPromoSchema } from '@school/shared/schemas/promo';
import { CURRENCIES } from '@school/shared/money/money';
import { useState } from 'react';
import { usePromosCreate, type CreatePromoDtoDiscount } from '@/shared/api';
import { parseMajor, type Currency } from '@/shared/lib';
import { Alert, Button, Input, Select } from '@/shared/ui';

const INITIAL = {
  code: '',
  kind: 'percent',
  value: '10',
  currency: 'UAH',
  from: '',
  until: '',
  maxUses: '100',
};

const atMidnight = (date: string): string => (date ? `${date}T00:00:00.000Z` : '');

export const CreatePromo = () => {
  const [fields, setFields] = useState(INITIAL);
  const [problems, setProblems] = useState<Partial<Record<string, string>>>({});
  const create = usePromosCreate({
    mutation: {
      onSuccess: () => {
        setFields(INITIAL);
      },
    },
  });
  const bind = (name: keyof typeof INITIAL, path: string = name) => ({
    value: fields[name],
    error: problems[path] ?? create.error?.fields?.find((item) => item.path === path)?.message,
    onChange: (event: { target: { value: string } }) => {
      setFields({ ...fields, [name]: event.target.value });
    },
  });
  return (
    <form
      noValidate
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        const discount: CreatePromoDtoDiscount =
          fields.kind === 'percent'
            ? { kind: 'percent', percent: Number(fields.value) }
            : {
                kind: 'fixed',
                amountMinor: parseMajor(fields.value) ?? 0,
                currency: fields.currency as Currency,
              };
        const parsed = createPromoSchema.safeParse({
          code: fields.code,
          discount,
          validFrom: atMidnight(fields.from),
          validUntil: atMidnight(fields.until),
          maxUses: Number(fields.maxUses),
        });
        if (!parsed.success) {
          setProblems(
            Object.fromEntries(
              parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
            ),
          );
          return;
        }
        setProblems({});
        create.mutate({ data: parsed.data });
      }}
    >
      {create.error && !create.error.fields ? (
        <div className="sm:col-span-2">
          <Alert>{create.error.message}</Alert>
        </div>
      ) : null}
      <Input label="Code" {...bind('code')} />
      <Select label="Discount type" {...bind('kind')}>
        <option value="percent">Percent</option>
        <option value="fixed">Fixed amount</option>
      </Select>
      <Input
        label={fields.kind === 'percent' ? 'Percent off' : 'Amount off'}
        inputMode="decimal"
        {...bind('value', 'discount')}
      />
      {fields.kind === 'fixed' ? (
        <Select label="Currency" {...bind('currency')}>
          {CURRENCIES.map((currency) => (
            <option key={currency}>{currency}</option>
          ))}
        </Select>
      ) : null}
      <Input label="Valid from (UTC)" type="date" {...bind('from', 'validFrom')} />
      <Input label="Valid until (UTC)" type="date" {...bind('until', 'validUntil')} />
      <Input label="Number of uses" inputMode="numeric" {...bind('maxUses')} />
      <div className="sm:col-span-2">
        <Button type="submit" pending={create.isPending}>
          Create promo code
        </Button>
      </div>
    </form>
  );
};
