import { Card, CardContent, CardHeader } from '@texflow/ui';

interface FeatureCardProps {
  icon: string;
  title: string;
  description: string;
}

export function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <Card className="h-full transition hover:border-purple-500/50">
      <CardHeader>
        <span className="text-4xl" role="img" aria-hidden>
          {icon}
        </span>
        <h3 className="text-xl font-bold text-white">{title}</h3>
      </CardHeader>
      <CardContent>
        <p className="text-slate-400">{description}</p>
      </CardContent>
    </Card>
  );
}
