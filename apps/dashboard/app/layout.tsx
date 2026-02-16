import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TexFlow Dashboard',
  description: 'Merchant dashboard for TexFlow',
};

export default function RootLayout({
  children,
}: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
