import { type ButtonHTMLAttributes } from 'react';

const STYLES = {
  primary: 'bg-blue-700 text-white hover:bg-blue-800',
  secondary: 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-100',
  danger: 'bg-red-700 text-white hover:bg-red-800',
} as const;

export const Button = ({
  variant = 'primary',
  pending = false,
  className = '',
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: keyof typeof STYLES;
  readonly pending?: boolean;
}) => (
  <button
    {...props}
    type={type}
    disabled={disabled === true || pending}
    aria-busy={pending}
    className={`min-h-11 rounded-md px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${STYLES[variant]} ${className}`}
  >
    {pending ? 'Please wait…' : children}
  </button>
);
