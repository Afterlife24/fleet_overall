import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/authStore';
import { getApp } from '@/constants/apps';
import { FileText, Plus, Sliders } from 'lucide-react';

/**
 * Generic placeholder page for the document apps (Quotation, LPO, Delivery
 * Note, Collection Note, Invoice, SOA, Payment Receipt).
 *
 * These are real, activatable apps now. Their detailed content will be built
 * later with the same schema-driven table/form + customizer the other apps use
 * — so this page is intentionally a clean starting point.
 */
export function DocumentAppPage({ appId }: { appId: string }) {
  const user = useAuthStore((s) => s.user);
  const app = getApp(appId);
  const isOwner = !!user && (user.isOwner || user.role === 'Managing Director' || user.role === 'Executive Manager');

  return (
    <div className="space-y-5">
      <PageHeader
        title={app?.name ?? 'Document'}
        description={app?.summary}
        actions={
          <>
            {isOwner && <Button variant="outline" size="sm"><Sliders className="mr-1.5 h-4 w-4" /> Customize</Button>}
            <Button size="sm"><Plus className="mr-1.5 h-4 w-4" /> New {app?.name}</Button>
          </>
        }
      />
      <EmptyState
        icon={FileText}
        title={`No ${app?.name?.toLowerCase() ?? 'documents'} yet`}
        description="Create your first document to get started. Fields and layout can be customized per company."
      />
    </div>
  );
}
