import { createHash } from 'node:crypto';
import { type OutgoingEmail } from '@school/db/repo/email-delivery';
import nodemailer from 'nodemailer';

export type Mailer = {
  readonly send: (email: OutgoingEmail) => Promise<void>;
  readonly close: () => void;
};

export const createMailer = (settings: {
  readonly host: string;
  readonly port: number;
  readonly from: string;
}): Mailer => {
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: false,
    pool: true,
    connectionTimeout: 5_000,
    socketTimeout: 15_000,
  });
  return {
    send: async (email) => {
      // The same email always carries the same Message-ID.
      const identity = createHash('sha256').update(email.dedupeKey).digest('hex').slice(0, 32);
      await transport.sendMail({
        from: settings.from,
        to: email.to,
        subject: email.subject,
        text: email.body,
        messageId: `<${identity}@school>`,
        headers: { 'X-Dedupe-Key': email.dedupeKey },
      });
    },
    close: () => {
      transport.close();
    },
  };
};
