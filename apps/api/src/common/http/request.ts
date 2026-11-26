import { type Request, type Response } from 'express';
import { type Principal } from '../auth/principal';

export type ApiRequest = Request & { principal?: Principal };

export const REQUEST_ID_HEADER = 'X-Request-Id';

export const requestIdOf = (response: Response): string | undefined => {
  const value = response.getHeader(REQUEST_ID_HEADER);
  return typeof value === 'string' ? value : undefined;
};

export const readCookie = (header: string | undefined, name: string): string | undefined =>
  header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
