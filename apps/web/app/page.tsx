import Link from 'next/link';
import { buttonVariants } from '@texflow/ui';
import { AgentPurchaseDemo } from '@/components/AgentPurchaseDemo';
import { FeatureCard } from '@/components/FeatureCard';
import { StatCard } from '@/components/StatCard';
import { cn } from '@texflow/ui';

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden bg-gradient-to-br from-purple-900 via-slate-900 to-slate-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <div className="text-center">
            <h1 className="text-5xl md:text-7xl font-bold text-white mb-6">
              Make Your Store
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
                Agent-Ready
              </span>
            </h1>
            <p className="text-xl text-gray-300 mb-8 max-w-3xl mx-auto">
              Enable AI agents like Claude and GPT-4 to browse your catalog and
              make purchases autonomously. Join the agentic internet revolution.
            </p>
            <div className="flex gap-4 justify-center flex-wrap">
              <Link
                href="/signup"
                className={cn(buttonVariants({ size: 'lg' }))}
              >
                Get Started Free
              </Link>
              <Link
                href="/docs"
                className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }))}
              >
                Read Docs
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 bg-slate-950">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-4xl font-bold text-center text-white mb-12">
            See It In Action
          </h2>
          <AgentPurchaseDemo />
        </div>
      </section>

      <section className="py-20 bg-slate-900">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid md:grid-cols-3 gap-8">
            <FeatureCard
              icon="🤖"
              title="Agent Discovery"
              description="Agents automatically find and understand your store through ACP protocol"
            />
            <FeatureCard
              icon="⚡"
              title="Instant Integration"
              description="Add one script tag or use our API - go live in minutes"
            />
            <FeatureCard
              icon="🔒"
              title="Secure Purchases"
              description="User approval required, full audit trails, PCI compliant"
            />
          </div>
        </div>
      </section>

      <section className="py-20 bg-slate-950">
        <div className="max-w-5xl mx-auto px-4">
          <div className="grid md:grid-cols-4 gap-8 text-center">
            <StatCard number="1M+" label="Agent Orders" />
            <StatCard number="500+" label="Merchants" />
            <StatCard number="99.9%" label="Uptime" />
            <StatCard number="&lt;200ms" label="API Response" />
          </div>
        </div>
      </section>

      <section className="py-20 bg-gradient-to-r from-purple-900 to-pink-900">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-4xl font-bold text-white mb-6">
            Ready to Enable Agentic Commerce?
          </h2>
          <p className="text-xl text-purple-100 mb-8">
            Join the future of e-commerce. Free for 100 orders/month.
          </p>
          <Link
            href="/signup"
            className={cn(
              buttonVariants({ size: 'lg' }),
              'bg-white text-purple-900 hover:bg-gray-100'
            )}
          >
            Start Now - It&apos;s Free
          </Link>
        </div>
      </section>
    </>
  );
}
