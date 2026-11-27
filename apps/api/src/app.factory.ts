import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import 'reflect-metadata';
import { AppModule } from './app.module';
import { jsonBody, rejectNulInUrl } from './common/http/body';
import { createDrain, type Drain } from './common/http/drain';
import { REQUEST_ID_HEADER } from './common/http/request';
import { type Deps } from './infra/deps';
import { SocketAdapter } from './infra/socket-adapter';
import { buildOpenApi } from './openapi';

const KEEP_ALIVE_MS = 75_000;

/** The fully configured application, not yet listening. Tests and `main` share it. */
export const createApp = async (
  deps: Deps,
  drain: Drain = createDrain(),
): Promise<NestExpressApplication> => {
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
  app.use(drain.middleware);
  app.use(helmet());
  app.enableCors({ origin: deps.env.CORS_ORIGINS, credentials: true });
  app.use(rejectNulInUrl);
  // Homework uploads are multipart and parsed by their own limited parser.
  app.use(jsonBody(deps.env.BODY_LIMIT_JSON_BYTES, /^\/api\/homework\/[^/]+\/submission\/?$/i));
  app.useWebSocketAdapter(new SocketAdapter(app, deps));
  app.setGlobalPrefix('api');
  SwaggerModule.setup('docs', app, () => buildOpenApi(app), { jsonDocumentUrl: 'docs-json' });
  await app.init();
  // Longer than the proxy keeps an idle connection, so the proxy is always the one to close it
  // and never sends a request into a connection this side has just dropped.
  const server = app.getHttpServer();
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  server.headersTimeout = KEEP_ALIVE_MS + 1_000;
  return app;
};
