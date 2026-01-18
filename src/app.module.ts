import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { GamesModule } from './games/games.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { JobsModule } from './jobs/jobs.module';
import { AgentModule } from './agent/agent.module';
import { FirebaseModule } from './infra/firebase/firebase.module';

@Module({
  imports: [
    UsersModule,
    GamesModule,
    WebhooksModule,
    JobsModule,
    AgentModule,
    FirebaseModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
