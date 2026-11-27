import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type Request } from 'express';
import { apiError } from '../errors/api-error';

/** For upload routes: anything but a multipart form is refused, an empty body included. */
@Injectable()
export class MultipartOnlyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.is('multipart/form-data')) {
      throw apiError('UNSUPPORTED_MEDIA_TYPE', 'Send multipart/form-data');
    }
    return next.handle();
  }
}
