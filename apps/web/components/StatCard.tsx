interface StatCardProps {
  number: string;
  label: string;
}

export function StatCard({ number, label }: StatCardProps) {
  return (
    <div className="text-center">
      <div className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 md:text-5xl">
        {number}
      </div>
      <div className="mt-2 text-slate-400">{label}</div>
    </div>
  );
}
