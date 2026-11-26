import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import 'reflect-metadata';
import { AppModule } from './app.module';
import { jsonBody, rejectNulInUrl } from './common/http/body';
import { REQUEST_ID_HEADER } from './common/http/request';
import { type Deps } from './infra/deps';
import { buildOpenApi } from './openapi';

/** The fully configured application, not yet listening. Tests and `main` share it. */
export const createApp = async (deps: Deps): Promise<NestExpressApplication> => {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(deps), {
    bodyParser: false,
    logger: false,
    abortOnError: false,
  });
  app.disable('x-powered-by');
  app.use(
    (
      _request: unknown,
      response: { setHeader: (n: string, v: string) => void },
      next: () => void,
    ) => {
      response.setHeader(REQUEST_ID_HEADER, randomUUID());
      response.setHeader('X-Instance', deps.env.INSTANCE_ID);
      next();
    },
  );
  app.use(helmet());
  app.enableCors({ origin: deps.env.CORS_ORIGINS, credentials: true });
  app.use(rejectNulInUrl);
  app.use(jsonBody(deps.env.BODY_LIMIT_JSON_BYTES));
  app.setGlobalPrefix('api');
  SwaggerModule.setup('docs', app, () => buildOpenApi(app), { jsonDocumentUrl: 'docs-json' });
  await app.init();
  return app;
};
