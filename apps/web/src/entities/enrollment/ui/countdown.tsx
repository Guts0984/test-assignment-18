'use client';

import { useEffect, useState } from 'react';
import { formatRemaining, remainingMs, serverOffsetMs } from '@/shared/lib';

/**
 * Time left to pay, counted on the server's clock: the device clock only measures how long
 * ago the server's answer arrived.
 */
export const Countdown = ({
  deadline,
  serverNow,
  receivedAt,
  onExpired,
}: {
  deadline: string;
  serverNow: string;
  /** Device time when the response carrying `serverNow` arrived. */
  receivedAt: number;
  onExpired: () => void;
}) => {
  const offset = serverOffsetMs(serverNow, receivedAt);
  const [now, setNow] = useState(() => Date.now());
  const left = remainingMs(deadline, offset, now);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 500);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const expired = left === 0;
  useEffect(() => {
    if (expired) onExpired();
    // The callback runs once per expiry, not on every re-render of the parent.
  }, [expired]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <p role="timer" aria-live="off" className="text-lg font-semibold tabular-nums">
      {expired ? 'The reservation has run out' : `Time left to pay: ${formatRemaining(left)}`}
    </p>
  );
};
