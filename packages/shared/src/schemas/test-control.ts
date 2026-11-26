import { z } from 'zod';
import { instantSchema } from './common';

export const setTestClockSchema = z.strictObject({ now: instantSchema });
export const testClockSchema = z.object({ now: instantSchema });
