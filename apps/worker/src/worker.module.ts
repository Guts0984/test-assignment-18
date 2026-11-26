import { type DynamicModule, Module } from '@nestjs/common';
import { DEPS, type WorkerDeps } from './deps';
import { QueueRunnerService } from './queue-runner.service';
import { SweeperService } from './sweeper/sweeper.service';

@Module({})
export class WorkerModule {
  static register(deps: WorkerDeps): DynamicModule {
    return {
      module: WorkerModule,
      providers: [{ provide: DEPS, useValue: deps }, QueueRunnerService, SweeperService],
    };
  }
}
