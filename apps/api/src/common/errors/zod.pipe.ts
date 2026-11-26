import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import { isZodDto } from 'nestjs-zod/dto';
import { z } from 'zod';
import { apiError } from './api-error';

/**
 * Validates every body, query and path parameter against its schema. A handler that declares one
 * without a schema is a programming error and fails loudly.
 */
@Injectable()
export class ZodPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type === 'custom') return value;
    const { metatype } = metadata;
    if (!isZodDto(metatype)) throw new Error(`No schema declared for a ${metadata.type} argument`);
    const schema = metatype.schema as z.ZodType;
    const parsed = schema.safeParse(value ?? {});
    if (parsed.success) return parsed.data;
    throw apiError(
      'VALIDATION_FAILED',
      'Check the highlighted fields',
      parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
}
