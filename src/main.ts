import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import cors from 'cors';

async function bootstrap() {
  // Keep Node process timezone UTC so Date/MySQL DATETIME stay consistent
  process.env.TZ = process.env.TZ || 'UTC';

  const app = await NestFactory.create(AppModule);

  app.use(cors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Accept,Authorization,X-Requested-With,x-razorpay-signature',
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  }));

  app.getHttpAdapter().get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  const configService = app.get(ConfigService);
  console.log('GEMINI_API_KEY loaded:', configService.get('GEMINI_API_KEY') ? 'YES' : 'NO');
  console.log('Timezone:', process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone);
  console.log('Server time:', new Date().toISOString());

  const port = parseInt(process.env.PORT || '5000', 10);
  await app.listen(port);
  console.log(`Listening on port ${port}`);
}
bootstrap();
