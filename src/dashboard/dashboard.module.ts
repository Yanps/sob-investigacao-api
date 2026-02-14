import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [JobsModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
