import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({ origin: true, credentials: true });

  app.getHttpAdapter().get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  const configService = app.get(ConfigService);
  console.log('GEMINI_API_KEY loaded:', configService.get('GEMINI_API_KEY') ? 'YES' : 'NO');

  const port = parseInt(process.env.PORT || '5000', 10);
  await app.listen(port);
  console.log(`Listening on port ${port}`);
}
bootstrap();
