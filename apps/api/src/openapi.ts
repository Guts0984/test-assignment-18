import { type INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { apiErrorSchema, ERROR_STATUS } from '@school/shared/errors/api-error';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { z } from 'zod';

const ERROR_STATUSES = [...new Set<number>(Object.values(ERROR_STATUS))].sort((a, b) => a - b);
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

const errorResponse = (status: number) => ({
  description: Object.entries(ERROR_STATUS)
    .filter(([, value]) => value === status)
    .map(([code]) => code)
    .join(', '),
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
});

/** Declares the one error body, with every code it can carry, on every operation. */
const declareErrors = (document: OpenAPIObject): OpenAPIObject => {
  const schema = z.toJSONSchema(apiErrorSchema, { target: 'openapi-3.0' });
  delete schema.$schema;
  const components = document.components ?? {};
  document.components = {
    ...components,
    schemas: { ...components.schemas, ApiError: schema as never },
  };
  for (const path of Object.values(document.paths)) {
    for (const method of METHODS) {
      const operation = path[method];
      if (!operation) continue;
      for (const status of ERROR_STATUSES) {
        operation.responses[String(status)] ??= errorResponse(status);
      }
    }
  }
  return document;
};

export const buildOpenApi = (app: INestApplication): OpenAPIObject => {
  const config = new DocumentBuilder().setTitle('Online school API').setVersion('1').build();
  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controller, method) => {
      const area = controller.replace(/Controller$/, '');
      return `${area.charAt(0).toLowerCase()}${area.slice(1)}${method.charAt(0).toUpperCase()}${method.slice(1)}`;
    },
  });
  return declareErrors(cleanupOpenApiDoc(document, { version: '3.0' }));
};
