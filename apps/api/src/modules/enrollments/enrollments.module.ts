import { Module } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';
import { WaitlistController } from './waitlist.controller';
import { WaitlistService } from './waitlist.service';

@Module({
  controllers: [EnrollmentsController, WaitlistController],
  providers: [EnrollmentsService, CheckoutService, WaitlistService],
})
export class EnrollmentsModule {}
