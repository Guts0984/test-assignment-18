export type Query = Readonly<Record<string, string>>;

/** Only the listed keys with a non-empty value are read from the address bar. */
export const readQuery = <K extends string>(
  search: string,
  keys: readonly K[],
): Partial<Record<K, string>> => {
  const params = new URLSearchParams(search);
  return Object.fromEntries(
    keys.flatMap((key) => {
      const value = params.get(key);
      return value ? [[key, value]] : [];
    }),
  ) as Partial<Record<K, string>>;
};

/** Empty values and the first page are left out, so equal filters give equal addresses. */
export const toSearch = (values: Readonly<Record<string, string | number | undefined>>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === '' || (key === 'page' && Number(value) <= 1)) continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
};

export const pageFrom = (value: string | undefined): number => {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1;
};
