import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { DEPS, type Deps } from '../../infra/deps';
import { HomeworkController } from './homework.controller';
import { HomeworkService } from './homework.service';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [DEPS],
      useFactory: (deps: Deps) => ({
        limits: {
          fileSize: deps.env.UPLOAD_MAX_BYTES,
          files: 1,
          fields: 4,
          fieldSize: 100_000,
          parts: 6,
        },
      }),
    }),
  ],
  controllers: [HomeworkController],
  providers: [HomeworkService],
})
export class HomeworkModule {}
