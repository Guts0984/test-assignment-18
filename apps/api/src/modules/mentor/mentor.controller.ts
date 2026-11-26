import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { idParamSchema } from '@school/shared/schemas/common';
import {
  claimResultSchema,
  claimSchema,
  mentorReviewsSchema,
  mentorStudentPageSchema,
  mentorStudentQuerySchema,
  mentorSubmissionSchema,
  queuePageSchema,
  queueQuerySchema,
  reviewSchema,
} from '@school/shared/schemas/homework';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { type Principal } from '../../common/auth/principal';
import { MentorService } from './mentor.service';

class IdParamDto extends createZodDto(idParamSchema) {}
class QueueQueryDto extends createZodDto(queueQuerySchema) {}
class StudentQueryDto extends createZodDto(mentorStudentQuerySchema) {}
class ClaimDto extends createZodDto(claimSchema) {}
class ReviewDto extends createZodDto(reviewSchema) {}
class QueuePageDto extends createZodDto(queuePageSchema) {}
class ReviewsDto extends createZodDto(mentorReviewsSchema) {}
class SubmissionDto extends createZodDto(mentorSubmissionSchema) {}
class ClaimResultDto extends createZodDto(claimResultSchema) {}
class StudentPageDto extends createZodDto(mentorStudentPageSchema) {}

@ApiTags('mentor')
@Roles('mentor')
@Controller('mentor')
export class MentorController {
  constructor(@Inject(MentorService) private readonly mentor: MentorService) {}

  @Get('queue')
  @ZodResponse({ status: 200, type: QueuePageDto })
  queue(@CurrentUser() user: Principal, @Query() query: QueueQueryDto) {
    return this.mentor.queue(user.id, query);
  }

  @Get('reviews')
  @ZodResponse({ status: 200, type: ReviewsDto })
  reviews(@CurrentUser() user: Principal) {
    return this.mentor.reviews(user.id);
  }

  @Post('queue/claim')
  @HttpCode(200)
  @ZodResponse({ status: 200, type: ClaimResultDto })
  claim(@CurrentUser() user: Principal, @Body() body: ClaimDto) {
    return this.mentor.claim(user.id, body.submissionId);
  }

  @Get('submissions/:id')
  @ZodResponse({ status: 200, type: SubmissionDto })
  submission(@CurrentUser() user: Principal, @Param() params: IdParamDto) {
    return this.mentor.submission(user.id, params.id);
  }

  @Post('submissions/:id/release')
  @HttpCode(204)
  async release(@CurrentUser() user: Principal, @Param() params: IdParamDto) {
    await this.mentor.release(user.id, params.id);
  }

  @Post('submissions/:id/review')
  @HttpCode(204)
  async review(
    @CurrentUser() user: Principal,
    @Param() params: IdParamDto,
    @Body() body: ReviewDto,
  ) {
    await this.mentor.review(user.id, params.id, body);
  }

  @Get('students')
  @ZodResponse({ status: 200, type: StudentPageDto })
  students(@CurrentUser() user: Principal, @Query() query: StudentQueryDto) {
    return this.mentor.students(user.id, query);
  }
}
