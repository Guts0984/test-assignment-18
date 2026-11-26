import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodSerializerInterceptor } from 'nestjs-zod';
import { AuthGuard } from './common/auth/auth.guard';
import { CsrfGuard } from './common/auth/csrf.guard';
import { ApiExceptionFilter } from './common/errors/exception.filter';
import { ZodPipe } from './common/errors/zod.pipe';
import { CoreModule } from './infra/core.module';
import { type Deps } from './infra/deps';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CohortsModule } from './modules/cohorts/cohorts.module';
import { CoursesModule } from './modules/courses/courses.module';
import { HealthModule } from './modules/health/health.module';
import { StaffModule } from './modules/staff/staff.module';
import { TestControlModule } from './modules/test-control/test-control.module';

@Module({})
export class AppModule {
  static register(deps: Deps): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.register(deps),
        AuthModule,
        StaffModule,
        CatalogModule,
        CoursesModule,
        CohortsModule,
        HealthModule,
        ...(deps.env.TEST_CLOCK_ENABLED ? [TestControlModule] : []),
      ],
      providers: [
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_PIPE, useClass: ZodPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    };
  }
}
