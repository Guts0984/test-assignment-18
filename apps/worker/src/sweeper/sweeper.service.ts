import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { DEPS, type WorkerDeps } from '../deps';
import { sweep } from './sweep';

/**
 * Sweeps on a plain timer rather than a repeatable job, so wiping Redis cannot remove the
 * thing that rebuilds Redis.
 */
@Injectable()
export class SweeperService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;
  private stopped = false;

  constructor(@Inject(DEPS) private readonly deps: WorkerDeps) {}

  onApplicationBootstrap(): void {
    this.schedule(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = sweep(this.deps)
        .catch((error: unknown) => {
          this.deps.logger.warn({ error: String(error) }, 'sweep failed');
        })
        .finally(() => {
          this.schedule(this.deps.env.SWEEP_INTERVAL_MS);
        });
    }, delayMs);
  }
}
