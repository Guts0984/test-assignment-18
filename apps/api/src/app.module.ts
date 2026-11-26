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
import { EnrollmentsModule } from './modules/enrollments/enrollments.module';
import { RosterModule } from './modules/roster/roster.module';
import { PromosModule } from './modules/promos/promos.module';
import { GatewayModule } from './modules/gateway/gateway.module';
import { PaymentsModule } from './modules/payments/payments.module';
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
        EnrollmentsModule,
        RosterModule,
        PromosModule,
        GatewayModule,
        PaymentsModule,
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
