import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { GamesModule } from './games/games.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { JobsModule } from './jobs/jobs.module';
import { AgentModule } from './agent/agent.module';
import { CodesModule } from './codes/codes.module';
import { AuthModule } from './auth/auth.module';
import { ModerationModule } from './moderation/moderation.module';
import { FirebaseModule } from './infra/firebase/firebase.module';
import { ApiKeyGuard } from './common/guards/api-key.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    FirebaseModule,
    AuthModule,
    UsersModule,
    GamesModule,
    WebhooksModule,
    JobsModule,
    AgentModule,
    CodesModule,
    ModerationModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
})
export class AppModule {}
