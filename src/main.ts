import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  
  console.log('GEMINI_API_KEY loaded:', configService.get('GEMINI_API_KEY') ? 'YES' : 'NO');
  
  await app.listen(3000);
}
bootstrap();
