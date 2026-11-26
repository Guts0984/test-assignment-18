import { runBusiness as run } from '@school/queue/business';
import { type Unit } from '@school/db/repo/context';
import { type Deps } from './deps';

export const runBusiness = <T>(deps: Deps, work: (unit: Unit) => Promise<T>): Promise<T> =>
  run(
    {
      ...deps,
      timings: { holdTtlSec: deps.env.HOLD_TTL_SEC, offerTtlSec: deps.env.OFFER_TTL_SEC },
    },
    work,
  );
