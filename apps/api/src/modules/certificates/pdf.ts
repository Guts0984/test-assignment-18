import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import PDFDocument from 'pdfkit';

export type CertificateText = {
  readonly studentName: string;
  readonly courseTitle: string;
  readonly schoolName: string;
  readonly number: number;
  readonly issuedOn: string;
  readonly verifyUrl: string;
};

/** A font that covers Latin and Cyrillic names. */
const fontPath = (file: string): string => {
  const requireFrom = createRequire(__filename);
  return join(dirname(requireFrom.resolve('dejavu-fonts-ttf/package.json')), 'ttf', file);
};

export const renderCertificate = (text: CertificateText): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 60,
      info: { Title: `Certificate ${text.number}` },
    });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    document.on('error', reject);
    const center = { align: 'center' } as const;
    document.font(fontPath('DejaVuSans-Bold.ttf')).fontSize(34).text('Certificate', center);
    document.moveDown().font(fontPath('DejaVuSans.ttf')).fontSize(14);
    document.text('This certifies that', center).moveDown(0.5);
    document.fontSize(28).text(text.studentName, center).moveDown(0.5);
    document.fontSize(14).text('has successfully completed', center).moveDown(0.5);
    document.fontSize(22).text(text.courseTitle, center).moveDown(0.5);
    document.fontSize(14).text(`at ${text.schoolName}`, center).moveDown(2);
    document.fontSize(11).text(`No. ${text.number}   ·   ${text.issuedOn}`, center);
    document.moveDown(0.5).text(text.verifyUrl, { ...center, link: text.verifyUrl });
    document.end();
  });
