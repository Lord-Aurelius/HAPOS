import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Analytics } from '@vercel/analytics/next';
import '@/app/globals.css';

export const metadata: Metadata = {
  title: 'HAPOS',
  description: 'House Aurelius Point of Sale',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
