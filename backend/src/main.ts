import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  const origins = process.env.CORS_ORIGIN?.split(',').map((s) => s.trim());
  app.enableCors({ origin: origins && origins.length ? origins : true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // If the web app was built (web/dist), serve it from the same address so one URL opens everything.
  const webDist = resolve(process.env.WEB_DIST || join(__dirname, '..', '..', 'web', 'dist'));
  if (existsSync(join(webDist, 'index.html'))) {
    app.useStaticAssets(webDist);
    app.use((req: any, res: any, next: () => void) =>
      req.method === 'GET' && !req.path.startsWith('/api') ? res.sendFile(join(webDist, 'index.html')) : next());
    new Logger('Bootstrap').log(`الويب بيتقدّم من ${webDist}`);
  }

  const port = +(process.env.PORT || 3000);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`جاهز على http://localhost:${port}`);
}
bootstrap();
