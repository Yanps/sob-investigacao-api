import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  try {
    console.log('🚀 Initializing NestJS application...');
    const app = await NestFactory.create(AppModule, {
      logger: ['error', 'warn', 'log'],
    });

    app.enableShutdownHooks();
    app.setGlobalPrefix('api');

    const port = parseInt(process.env.PORT || '3000', 10);
    const host = '0.0.0.0';

    console.log(`🚀 Starting server on ${host}:${port}`);
    await app.listen(port, host);
    console.log(`✅ Server is running on ${host}:${port}`);
  } catch (error) {
    console.error('❌ Error starting server:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    process.exit(1);
  }
}
void bootstrap();
