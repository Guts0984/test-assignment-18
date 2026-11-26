'use client';

import { useQueryClient } from '@tanstack/react-query';
import { CURRENCIES } from '@school/shared/money/money';
import Link from 'next/link';
import { useState } from 'react';
import {
  getCatalogSearchQueryKey,
  useCatalogDirections,
  useCatalogSearch,
  type CatalogPageDtoOutput,
  type CatalogSearchCurrency,
} from '@/shared/api';
import {
  formatDay,
  formatMoney,
  pageFrom,
  parseMajor,
  toMajor,
  useLive,
  useUrlQuery,
} from '@/shared/lib';
import { Alert, Button, Card, Input, Page, Pagination, QueryState, Select } from '@/shared/ui';

const KEYS = [
  'q',
  'direction',
  'startFrom',
  'startTo',
  'currency',
  'priceMin',
  'priceMax',
  'page',
] as const;

type Filters = Partial<Record<(typeof KEYS)[number], string>>;

const FilterForm = ({
  initial,
  onSearch,
}: {
  initial: Filters;
  onSearch: (filters: Filters) => void;
}) => {
  const major = (minor: string | undefined) => (minor ? toMajor(Number(minor)) : '');
  const [fields, setFields] = useState({
    ...initial,
    priceMin: major(initial.priceMin),
    priceMax: major(initial.priceMax),
  });
  const directions = useCatalogDirections();
  const bind = (name: Exclude<(typeof KEYS)[number], 'page'>) => ({
    value: fields[name] ?? '',
    onChange: (event: { target: { value: string } }) => {
      setFields({ ...fields, [name]: event.target.value });
    },
  });
  const priced = Boolean(fields.priceMin || fields.priceMax);
  const minor = (text: string) => {
    const value = text ? parseMajor(text) : null;
    return value === null ? '' : String(value);
  };
  return (
    <form
      role="search"
      noValidate
      className="grid gap-3 sm:grid-cols-3"
      onSubmit={(event) => {
        event.preventDefault();
        // A new search starts at the first page.
        const rest = { ...fields, page: '' };
        onSearch({ ...rest, priceMin: minor(fields.priceMin), priceMax: minor(fields.priceMax) });
      }}
    >
      <Input label="Course title" type="search" {...bind('q')} />
      <Select label="Direction" {...bind('direction')}>
        <option value="">Any</option>
        {directions.data?.items.map((direction) => (
          <option key={direction}>{direction}</option>
        ))}
      </Select>
      <Select
        label="Currency"
        error={priced && !fields.currency ? 'Choose a currency to filter by price' : undefined}
        {...bind('currency')}
      >
        <option value="">Any</option>
        {CURRENCIES.map((currency) => (
          <option key={currency}>{currency}</option>
        ))}
      </Select>
      <Input label="Starts from" type="date" {...bind('startFrom')} />
      <Input label="Starts until" type="date" {...bind('startTo')} />
      <div className="grid grid-cols-2 gap-2">
        <Input label="Price from" inputMode="decimal" {...bind('priceMin')} />
        <Input label="Price to" inputMode="decimal" {...bind('priceMax')} />
      </div>
      <div>
        <Button type="submit" disabled={priced && !fields.currency}>
          Search
        </Button>
      </div>
    </form>
  );
};

export const CatalogPage = () => {
  const [query, setQuery] = useUrlQuery(KEYS);
  const page = pageFrom(query.page);
  const params = {
    page,
    ...(query.q ? { q: query.q } : {}),
    ...(query.direction ? { direction: query.direction } : {}),
    ...(query.startFrom ? { startFrom: query.startFrom } : {}),
    ...(query.startTo ? { startTo: query.startTo } : {}),
    ...(query.currency ? { currency: query.currency as CatalogSearchCurrency } : {}),
    ...(query.priceMin ? { priceMin: Number(query.priceMin) } : {}),
    ...(query.priceMax ? { priceMax: Number(query.priceMax) } : {}),
  };
  const results = useCatalogSearch(params);
  const client = useQueryClient();
  useLive({
    room: { kind: 'catalog' },
    event: 'seats.changed',
    onEvent: ({ cohortId, freeSeats }) => {
      client.setQueriesData<CatalogPageDtoOutput>(
        { queryKey: ['/api/catalog/cohorts'] },
        (data) =>
          data && {
            ...data,
            items: data.items.map((item) =>
              item.cohortId === cohortId ? { ...item, freeSeats } : item,
            ),
          },
      );
    },
    onResync: () => {
      void client.invalidateQueries({ queryKey: getCatalogSearchQueryKey() });
    },
  });
  return (
    <Page title="Courses">
      <Card label="Filters">
        {/* A new key resets the fields when Back or Forward changes the address. */}
        <FilterForm
          key={JSON.stringify(query)}
          initial={query}
          onSearch={(filters) => {
            setQuery(filters);
          }}
        />
      </Card>
      {results.error?.fields ? (
        <Alert>{results.error.fields.map((field) => field.message).join('. ')}</Alert>
      ) : (
        <QueryState query={results}>
          {(data) => (
            <>
              {data.items.length === 0 ? <p>No cohorts match these filters.</p> : null}
              <ul className="grid gap-3 sm:grid-cols-2">
                {data.items.map((item) => (
                  <li key={item.cohortId} data-testid={`cohort-${item.cohortId}`}>
                    <Card>
                      <h2 className="font-semibold">
                        <Link className="underline" href={`/courses/${item.courseId}`}>
                          {item.title}
                        </Link>
                      </h2>
                      <p className="text-sm text-slate-600">
                        {item.direction} · {item.schoolName}
                      </p>
                      <p>
                        Starts {formatDay(item.startDate)} · {item.timeZone}
                      </p>
                      <p className="font-medium">{formatMoney(item.priceMinor, item.currency)}</p>
                      <p data-testid="free-seats">
                        {item.freeSeats > 0
                          ? `${item.freeSeats} of ${item.capacity} seats free`
                          : 'No free seats'}
                      </p>
                    </Card>
                  </li>
                ))}
              </ul>
              <Pagination
                {...data}
                onChange={(next) => {
                  setQuery({ ...query, page: next });
                }}
              />
            </>
          )}
        </QueryState>
      )}
    </Page>
  );
};
