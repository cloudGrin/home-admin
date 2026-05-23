import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '~/modules/auth/auth.module';
import { FileModule } from '~/modules/file/file.module';
import { InsuranceModule } from '~/modules/insurance/insurance.module';
import { TaskModule } from '~/modules/task/task.module';
import { AutomationTaskController } from './controllers/automation-task.controller';
import { AutomationTaskConfigEntity } from './entities/automation-task-config.entity';
import { AutomationTaskLogEntity } from './entities/automation-task-log.entity';
import { AutomationTaskExecutorService } from './services/automation-task-executor.service';
import { AutomationTaskRegistryService } from './services/automation-task-registry.service';
import { AutomationTaskSchedulerService } from './services/automation-task-scheduler.service';
import { AutomationTaskService } from './services/automation-task.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([AutomationTaskConfigEntity, AutomationTaskLogEntity]),
    AuthModule,
    TaskModule,
    InsuranceModule,
    FileModule,
  ],
  controllers: [AutomationTaskController],
  providers: [
    AutomationTaskRegistryService,
    AutomationTaskExecutorService,
    AutomationTaskService,
    AutomationTaskSchedulerService,
  ],
})
export class AutomationModule {}
