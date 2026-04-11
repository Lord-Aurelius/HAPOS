'use client';

import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

type FormSubmitButtonProps = Omit<ComponentPropsWithoutRef<'button'>, 'children'> & {
  children: ReactNode;
  pendingLabel?: ReactNode;
};

export function FormSubmitButton({
  children,
  pendingLabel,
  disabled,
  type = 'submit',
  ...props
}: FormSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type={type}
      disabled={disabled || pending}
      aria-disabled={disabled || pending}
      {...props}
    >
      {pending ? pendingLabel ?? children : children}
    </button>
  );
}
