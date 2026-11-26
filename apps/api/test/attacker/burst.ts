/** Starts `count` operations at the same moment and returns every result. */
export const burst = async <T>(count: number, run: (index: number) => Promise<T>): Promise<T[]> => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = Array.from({ length: count }, async (_, index) => {
    await gate;
    return run(index);
  });
  release();
  return Promise.all(pending);
};
