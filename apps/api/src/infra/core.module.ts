import { type DynamicModule, Global, Module } from '@nestjs/common';
import { DEPS, type Deps } from './deps';

@Global()
@Module({})
export class CoreModule {
  static register(deps: Deps): DynamicModule {
    return { module: CoreModule, providers: [{ provide: DEPS, useValue: deps }], exports: [DEPS] };
  }
}
