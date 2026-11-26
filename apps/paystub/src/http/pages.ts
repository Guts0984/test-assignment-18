import { type SessionRow } from '../store';

export const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

const money = (minor: string, currency: string): string =>
  `${(Number(minor) / 100).toFixed(2)} ${escapeHtml(currency)}`;

const layout = (title: string, body: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem}
button{font:inherit;padding:.75rem 1rem;margin:.25rem 0;width:100%}
table{width:100%;border-collapse:collapse;font-size:.875rem}
td,th{border-bottom:1px solid #ddd;padding:.25rem;text-align:left;word-break:break-all}</style>
</head><body>${body}</body></html>`;

/** Form actions are relative, so the pages work behind a path prefix. */
export const paymentPage = (session: SessionRow): string => {
  const action = (name: string, label: string) =>
    `<form method="post" action="${session.id}/${name}"><button>${label}</button></form>`;
  const body =
    session.status === 'paid'
      ? `<p>This payment is complete.</p><p><a href="${escapeHtml(session.return_url)}">Return to the school</a></p>`
      : action('pay', 'Pay') +
        action('decline', 'Decline') +
        action('close', 'Close without paying');
  return layout(
    'Payment',
    `<h1>${escapeHtml(session.description)}</h1>
<p><strong>${money(session.amount_minor, session.currency)}</strong></p>${body}`,
  );
};

export const transactionsPage = (data: {
  readonly payments: readonly SessionRow[];
  readonly refunds: readonly {
    refund_id: string;
    order_id: string;
    amount_minor: string;
    currency: string;
  }[];
}): string => {
  const row = (cells: readonly string[]) =>
    `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  const payments = data.payments.map((p) =>
    row([escapeHtml(p.order_id), money(p.amount_minor, p.currency), escapeHtml(p.status)]),
  );
  const refunds = data.refunds.map((r) =>
    row([escapeHtml(r.order_id), money(r.amount_minor, r.currency), escapeHtml(r.refund_id)]),
  );
  return layout(
    'Payment system',
    `<h1>Payments</h1><table><tr><th>Order</th><th>Amount</th><th>Status</th></tr>${payments.join('')}</table>
<h1>Refunds</h1><table><tr><th>Order</th><th>Amount</th><th>Refund</th></tr>${refunds.join('')}</table>`,
  );
};

export const notFoundPage = (): string => layout('Not found', '<h1>Not found</h1>');
