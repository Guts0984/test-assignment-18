import { Module } from '@nestjs/common';
import { TestControlController } from './test-control.controller';

@Module({ controllers: [TestControlController] })
export class TestControlModule {}
