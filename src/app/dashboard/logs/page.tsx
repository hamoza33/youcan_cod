import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/badge';
import { prisma } from '@/lib/db';
import { formatDate } from '@/lib/utils';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = 'force-dynamic';

export default async function LogsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const logs = await prisma.logEvent.findMany({
    where: {
      source: typeof params.source === 'string' && params.source ? (params.source as never) : undefined,
      level: typeof params.level === 'string' && params.level ? (params.level as never) : undefined,
    },
    include: { codProduct: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return (
    <>
      <PageHeader title="Automation logs" description="Operational logs for COD import, sync, AI SEO generation, YouCan pushes, and Google Merchant Center submissions." />
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Level</th>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Message</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.map((log) => (
              <tr key={log.id}>
                <td className="px-4 py-3 text-xs text-slate-500">{formatDate(log.createdAt)}</td>
                <td className="px-4 py-3"><Badge>{log.source}</Badge></td>
                <td className="px-4 py-3"><Badge tone={log.level === 'ERROR' ? 'red' : log.level === 'WARN' ? 'amber' : 'slate'}>{log.level}</Badge></td>
                <td className="px-4 py-3 font-mono text-xs">{log.codProduct?.codSku ?? log.codProduct?.codProductId ?? '—'}</td>
                <td className="px-4 py-3 text-slate-700">{log.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
