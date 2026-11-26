/** Waits until `probe` returns something truthy, and fails loudly if it never does. */
export const until = async <T>(
  probe: () => Promise<T>,
  options: { readonly timeoutMs?: number; readonly what?: string } = {},
): Promise<NonNullable<T>> => {
  const deadline = Date.now() + (options.timeoutMs ?? 20_000);
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${options.what ?? 'a condition'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
