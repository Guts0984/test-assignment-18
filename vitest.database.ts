import { createTemplateDatabase } from '@school/db/testing/database';

export const setup = async (): Promise<void> => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is missing: copy .env.example to .env');
  await createTemplateDatabase(url);
};
