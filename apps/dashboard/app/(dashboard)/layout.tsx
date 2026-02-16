import Link from 'next/link';

const nav = [
  { href: '/', label: 'Overview' },
  { href: '/products', label: 'Products' },
  { href: '/orders', label: 'Orders' },
  { href: '/agents', label: 'Agents' },
  { href: '/webhooks', label: 'Webhooks' },
  { href: '/api-keys', label: 'API Keys' },
  { href: '/settings', label: 'Settings' },
  { href: '/texflow-md', label: 'TexFlow.md' },
];

export default function DashboardLayout({
  children,
}: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r border-slate-800 bg-slate-900/50 p-4">
        <Link href="/" className="text-lg font-bold text-white">
          TexFlow
        </Link>
        <nav className="mt-6 flex flex-col gap-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
