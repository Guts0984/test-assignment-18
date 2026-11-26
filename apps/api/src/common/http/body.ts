import { type ErrorCode, statusForCode } from '@school/shared/errors/api-error';
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { requestIdOf } from './request';

const NUL = String.fromCharCode(0);

/** Rejects keys that could reach a prototype, and strings PostgreSQL cannot store. */
const safeReviver = (key: string, value: unknown): unknown => {
  const forbidden = key === '__proto__' || (typeof value === 'string' && value.includes(NUL));
  if (forbidden) throw new SyntaxError('Forbidden content');
  return value;
};

const reject = (response: Response, code: ErrorCode, message: string): void => {
  response.status(statusForCode(code)).json({ code, message, requestId: requestIdOf(response) });
};

const hasBody = (request: Request): boolean =>
  request.headers['transfer-encoding'] !== undefined ||
  Number(request.headers['content-length'] ?? 0) > 0;

/**
 * Accepts JSON only, up to the limit. Paths in `rawPaths` (uploads) handle their own bodies.
 * The raw bytes are kept for signature checks.
 */
export const jsonBody = (limit: number, rawPaths: RegExp | null = null): RequestHandler => {
  const parse = express.json({
    limit,
    strict: true,
    reviver: safeReviver,
    verify: (request, _response, buffer) => {
      (request as Request & { rawBody?: Buffer }).rawBody = buffer;
    },
  });
  return (request: Request, response: Response, next: NextFunction) => {
    if (rawPaths?.test(request.path) === true) {
      next();
    } else if (hasBody(request) && !request.is('application/json')) {
      reject(response, 'UNSUPPORTED_MEDIA_TYPE', 'Send application/json');
    } else {
      parse(request, response, (error?: unknown) => {
        if (error === undefined) {
          next();
        } else if ((error as { type?: string }).type === 'entity.too.large') {
          reject(response, 'PAYLOAD_TOO_LARGE', 'The request body is too large');
        } else {
          reject(response, 'MALFORMED_REQUEST', 'The body is not valid JSON');
        }
      });
    }
  };
};

export const rejectNulInUrl: RequestHandler = (request, response, next) => {
  if (request.originalUrl.includes('%00')) {
    reject(response, 'MALFORMED_REQUEST', 'The address contains a forbidden character');
  } else {
    next();
  }
};
