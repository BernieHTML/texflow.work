import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'TexFlow - Make Your Store Agent-Ready',
  description:
    'Enable AI agents like Claude and GPT-4 to browse your catalog and make purchases autonomously. Join the agentic internet revolution.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 font-sans antialiased">
        <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
            <Link href="/" className="text-xl font-bold text-white">
              TexFlow
            </Link>
            <nav className="flex items-center gap-6">
              <Link
                href="/how-it-works"
                className="text-slate-300 hover:text-white transition-colors"
              >
                How it works
              </Link>
              <Link
                href="/pricing"
                className="text-slate-300 hover:text-white transition-colors"
              >
                Pricing
              </Link>
              <Link
                href="/docs"
                className="text-slate-300 hover:text-white transition-colors"
              >
                Docs
              </Link>
              <Link
                href="/login"
                className="text-slate-300 hover:text-white transition-colors"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition-colors"
              >
                Get Started
              </Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
