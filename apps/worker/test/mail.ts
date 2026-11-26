export type Mail = { readonly ID: string; readonly Subject: string };

const base = () => process.env['MAILPIT_API_URL'] ?? 'http://127.0.0.1:8025';

/** What the mailbox really received for an address. */
export const inbox = async (address: string): Promise<readonly Mail[]> => {
  const response = await fetch(
    `${base()}/api/v1/search?limit=200&query=${encodeURIComponent(`to:"${address}"`)}`,
  );
  if (!response.ok) throw new Error(`Mailbox answered ${response.status}`);
  return ((await response.json()) as { messages: Mail[] }).messages;
};
