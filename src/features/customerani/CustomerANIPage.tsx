import { useState, useMemo } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { KPICard } from '@/components/common/KPICard';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { SlideOver } from '@/components/common/SlideOver';
import { StatusBadge } from '@/components/common/StatusBadge';
import { InfoGrid, InfoRow, SectionTitle } from '@/components/common/InfoGrid';
import { Button } from '@/components/ui/button';
import { LoadingState, ErrorState } from '@/components/common/EmptyState';
import { useCustomerANIs, useUpdateCustomerANI, useDeleteCustomerANI } from '@/hooks/useQueries';
import { AppOnboarding } from '@/features/apps/AppOnboarding';
import { useAppOnboarding } from '@/hooks/useAppOnboarding';
import type { CustomerANI, CustomerANIStatus } from '@/types/customerani';
import { formatCurrency } from '@/utils/format';
import { cn } from '@/lib/utils';
import { CustomerANIFormDialog } from './CustomerANIFormDialog';
import {
  Plus, Users2, Download, Filter, CheckCircle2, XCircle,
  WifiHigh, Building2, CreditCard, Phone,
} from 'lucide-react';
import { toastSuccess } from '@/lib/toast-helper';

const STATUSES: (CustomerANIStatus | 'All')[] = ['All', 'Active', 'Inactive', 'Suspended'];

export function CustomerANIPage() {
  const { data: records, isLoading, isError, refetch } = useCustomerANIs();
  const updateMutation = useUpdateCustomerANI();
  const deleteMutation = useDeleteCustomerANI();
  const onboarding = useAppOnboarding('customer_ani', records?.length ?? 0);

  const [statusFilter, setStatusFilter] = useState<CustomerANIStatus | 'All'>('All');
  const [selected, setSelected] = useState<CustomerANI | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CustomerANI | undefined>(undefined);

  const data = useMemo(
    () =>
      (records as CustomerANI[] ?? []).filter((r) =>
        statusFilter === 'All' ? true : r.status === statusFilter
      ),
    [records, statusFilter]
  );

  if (isError) return <ErrorState onRetry={() => refetch()} />;

  if (!isLoading && onboarding.showOnboarding) {
    return (
      <AppOnboarding
        appId="customer_ani"
        mode={onboarding.mode}
        onDone={() => { onboarding.dismiss(); refetch(); }}
      />
    );
  }

  // ── KPI aggregates ───────────────────────────────────────────────────────
  const all = (records ?? []) as CustomerANI[];
  const activeCount = all.filter((r) => r.status === 'Active').length;
  const aniEnabled = all.filter((r) => r.aniRavaliActive).length;
  const totalATTL = all.reduce((s, r) => s + (r.attl ?? 0), 0);
  const suspendedCount = all.filter((r) => r.status === 'Suspended').length;

  // ── Table columns ────────────────────────────────────────────────────────
  const columns: Column<CustomerANI>[] = [
    {
      key: 'fleetLogId', header: 'Fleet Log ID', sortable: true, width: '110px',
      render: (r) => <span className="font-mono text-xs font-semibold text-foreground">{r.fleetLogId}</span>,
    },
    {
      key: 'aniRavaliActive', header: 'ANI Ravali', sortable: true, sortAccessor: (r) => r.aniRavaliActive ? 1 : 0,
      render: (r) => r.aniRavaliActive ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
          <CheckCircle2 className="h-3 w-3" /> Active
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          <XCircle className="h-3 w-3" /> Inactive
        </span>
      ),
    },
    {
      key: 'customerId', header: 'Customer ID', sortable: true,
      render: (r) => <span className="font-mono text-xs text-muted-foreground">{r.customerId}</span>,
    },
    {
      key: 'customerName', header: 'Customer Name', sortable: true,
      render: (r) => (
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{r.customerName}</span>
          <span className="text-xs text-muted-foreground">{r.branchName}</span>
        </div>
      ),
    },
    {
      key: 'trn', header: 'TRN', sortable: true,
      render: (r) => <span className="font-mono text-xs text-foreground">{r.trn}</span>,
    },
    {
      key: 'address', header: 'Address',
      render: (r) => (
        <span className="max-w-[200px] truncate text-xs text-muted-foreground" title={r.address}>
          {r.address}
        </span>
      ),
    },
    {
      key: 'attl', header: 'ATTL', sortable: true, sortAccessor: (r) => r.attl,
      render: (r) => (
        <span className="tabular-nums font-semibold text-foreground">
          {formatCurrency(r.attl)}
        </span>
      ),
    },
    {
      key: 'contactNumber', header: 'Contact Number',
      render: (r) => <span className="text-xs tabular-nums">{r.contactNumber}</span>,
    },
    {
      key: 'status', header: 'Status', sortable: true,
      render: (r) => <StatusBadge status={r.status} size="sm" />,
    },
  ];

  // ── Toggle ANI Ravali from the table row action ──────────────────────────
  const toggleANI = (record: CustomerANI) => {
    updateMutation.mutate(
      { id: record.id, data: { aniRavaliActive: !record.aniRavaliActive } },
      {
        onSuccess: () =>
          toastSuccess(
            record.aniRavaliActive
              ? `ANI Ravali deactivated for ${record.customerName}`
              : `ANI Ravali activated for ${record.customerName}`
          ),
      }
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Customer ANI"
        description="Customer Account & Network Integration — manage Fleet Log entries, TRN, ATTL and ANI Ravali status"
        actions={
          <>
            <Button variant="outline" size="sm">
              <Download className="mr-1.5 h-4 w-4" /> Export
            </Button>
            <Button size="sm" onClick={() => { setEditTarget(undefined); setFormOpen(true); }}>
              <Plus className="mr-1.5 h-4 w-4" /> New Customer
            </Button>
          </>
        }
      />

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard label="Active Customers" value={activeCount} icon={Users2} color="blue" />
        <KPICard label="ANI Ravali Active" value={aniEnabled} icon={WifiHigh} color="teal" />
        <KPICard label="Total ATTL" value={formatCurrency(totalATTL)} icon={CreditCard} color="indigo" />
        <KPICard label="Suspended" value={suspendedCount} icon={Building2} color="red" />
      </div>

      {/* ── Status filter ── */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Status:</span>
        <div className="flex flex-wrap gap-1">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                statusFilter === s
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">{data.length} records</span>
      </div>

      {/* ── Main table ── */}
      {isLoading ? (
        <LoadingState />
      ) : (
        <DataTable<CustomerANI>
          columns={columns}
          data={data}
          searchable
          searchPlaceholder="Search customers…"
          searchKeys={['customerName', 'customerId', 'fleetLogId', 'trn', 'contactNumber', 'address']}
          initialSort={{ key: 'fleetLogId', direction: 'asc' }}
          onRowClick={setSelected}
          rowKey={(r) => r.id}
          pageSize={15}
          emptyMessage="No customer ANI records found."
        />
      )}

      {/* ── Detail slide-over ── */}
      <SlideOver
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.customerName ?? 'Customer Detail'}
      >
        {selected && (
          <div className="space-y-5">
            {/* ANI Ravali activation toggle */}
            <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 p-4">
              <div>
                <p className="text-sm font-semibold text-foreground">ANI Ravali Status</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {selected.aniRavaliActive
                    ? 'Integration is currently active for this customer.'
                    : 'Integration is inactive. Click to activate.'}
                </p>
              </div>
              <Button
                size="sm"
                variant={selected.aniRavaliActive ? 'outline' : 'default'}
                onClick={() => { toggleANI(selected); setSelected({ ...selected, aniRavaliActive: !selected.aniRavaliActive }); }}
                className={cn(selected.aniRavaliActive && 'text-rose-600 hover:text-rose-700 dark:text-rose-400')}
              >
                {selected.aniRavaliActive ? 'Deactivate ANI' : 'Activate ANI'}
              </Button>
            </div>

            <SectionTitle>Fleet Log & Identity</SectionTitle>
            <InfoGrid>
              <InfoRow label="Fleet Log ID" value={selected.fleetLogId} />
              <InfoRow label="Customer ID" value={selected.customerId} />
              <InfoRow label="Customer Name" value={selected.customerName} />
              <InfoRow label="Status" value={<StatusBadge status={selected.status} size="sm" />} />
              <InfoRow label="Branch" value={selected.branchName} />
            </InfoGrid>

            <SectionTitle>Tax & Financial</SectionTitle>
            <InfoGrid>
              <InfoRow label="TRN" value={selected.trn} />
              <InfoRow label="ATTL (Credit Limit)" value={formatCurrency(selected.attl)} />
            </InfoGrid>

            <SectionTitle>Contact & Location</SectionTitle>
            <InfoGrid>
              <InfoRow label="Contact Number" value={selected.contactNumber} />
              <InfoRow label="Address" value={selected.address} />
            </InfoGrid>

            {selected.notes && (
              <>
                <SectionTitle>Notes</SectionTitle>
                <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                  {selected.notes}
                </p>
              </>
            )}

            <div className="flex gap-2 pt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setEditTarget(selected); setSelected(null); setFormOpen(true); }}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-rose-600 hover:text-rose-700 dark:text-rose-400"
                onClick={() => {
                  deleteMutation.mutate(selected.id, {
                    onSuccess: () => { toastSuccess('Customer ANI record deleted'); setSelected(null); },
                  });
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        )}
      </SlideOver>

      {/* ── Add / Edit dialog ── */}
      <CustomerANIFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditTarget(undefined); }}
        editRecord={editTarget}
      />
    </div>
  );
}
