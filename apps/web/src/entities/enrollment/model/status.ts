import { type EnrollmentStatus } from '@school/shared/status/enrollment';

export const STATUS_LABELS: Readonly<Record<EnrollmentStatus, string>> = {
  held: 'Seat reserved',
  offered: 'Seat offered to you',
  paid: 'Enrolled',
  transferred: 'Transferred',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  expired: 'Reservation expired',
  completed: 'Completed',
};

export const awaitsPayment = (status: EnrollmentStatus): boolean =>
  status === 'held' || status === 'offered';
