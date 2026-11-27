import { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { SlideOver } from '@/components/common/SlideOver';
import { StatusBadge } from '@/components/common/StatusBadge';
import { TPCBadge } from '@/components/common/TPCBadge';
import { getTPCStatus } from '@/constants/tpcStatus';
import { InfoGrid, InfoRow, SectionTitle } from '@/components/common/InfoGrid';
import { Timeline } from '@/components/common/Timeline';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Machine, MachineCategory, MachineStatus } from '@/types/machine';
import { useArchiveMachine, useFleetMachines, useSetMachineStatus } from '@/hooks/useApiResources';
import { LoadingState } from '@/components/common/EmptyState';
import { ApiErrorNotice, ApiSessionGate, errorText } from '@/components/common/ApiStatus';
import { formatCurrency, formatDate, formatNumber, daysUntil } from '@/utils/format';
import { getStatusColor } from '@/utils/statusColors';
import { cn } from '@/lib/utils';
import { AppOnboarding } from '@/features/apps/AppOnboarding';
import { SchemaCustomizer } from '@/features/apps/SchemaCustomizer';
import { SchemaFilterBar, applySchemaFilters } from '@/features/apps/SchemaFilterBar';
import { useAppOnboarding } from '@/hooks/useAppOnboarding';
import { JA_ORG_ID, useAuthStore } from '@/store/authStore';
import { canInitiate } from '@/services/collectionCore';
import { resolveFleetQueryForCurrentOrg } from '@/services/collectionDocs';
import { toMachineLite, machineResolverFor } from '@/features/fleet/collectionWiring';
import { MachineQrPanel } from '@/features/fleet/MachineQrPanel';
import { MachineApiFormDialog } from '@/features/fleet/MachineApiFormDialog';
import { MachineModelsDialog } from '@/features/fleet/MachineModelsDialog';
import { MachineDocumentsSection } from '@/features/fleet/MachineDocumentsSection';
import { OPERATIONAL_STATUSES } from '../../../shared/dto/index';
import { InitiateDialog } from '@/features/collection/InitiateDialog';
import { toastError, toastSuccess } from '@/lib/toast-helper';
import { useOrgStore } from '@/store/orgStore';
import { tableFields, filterableFields } from '@/types/schema';
import {
  Plus, Filter, Download, Forklift, Wrench, Calendar,
  MapPin, Gauge, Battery, Building2, ShieldAlert, Sliders,
} from 'lucide-react';

const CATEGORIES: (MachineCategory | 'All')[] = ['All', 'Articulating Boom', 'Telescopic Boom', 'Scissor Lift', 'Telehandler', 'Vertical Mast', 'Trailer Mounted'];
const STATUSES: (MachineStatus | 'All')[] = ['All', 'Available', 'On Hire', 'Under Repair', 'In Workshop', 'PDI', 'PHI', 'Transport', 'Breakdown', 'Offline'];

const DEEP_LINK_MESSAGES: Record<string, string> = {
  DEEP_LINK_NOT_FOUND: 'Machine not found for this link (DEEP_LINK_NOT_FOUND)',
  NOT_FOUND: 'Machine not found (NOT_FOUND)',
  OTHER_ORG: 'This QR code belongs to another organisation (OTHER_ORG)',
  AMBIGUOUS: 'Fleet number matches more than one machine (AMBIGUOUS)',
  MISMATCH: 'QR code does not match the machine record (MISMATCH)',
  OTHER: 'Unrecognised QR code (OTHER)',
};


/** Fleet screen. Reads and writes `/api/v1/machines`, `/machine-models` and machine documents; waits for the API session. */
export function FleetPage() {
  return (
    <ApiSessionGate>
      <FleetScreen />
    </ApiSessionGate>
  );
}

function FleetScreen() {
  const { data: machines, isLoading, isError, error, refetch } = useFleetMachines();
  // The server already limits the list to the branches this user may see.
  const filtered = useMemo(() => machines ?? [], [machines]);
  const onboarding = useAppOnboarding('fleet', machines?.length ?? 0);
  const authUser = useAuthStore((s) => s.user);
  const isOwner = !!authUser && (authUser.isOwner || authUser.role === 'Managing Director' || authUser.role === 'Executive Manager');
  const getAppSchema = useOrgStore((s) => s.getAppSchema);
  useOrgStore((s) => s.appSchemas); // re-render when schema changes
  const schema = authUser ? getAppSchema(authUser.orgId, 'fleet') : [];
  const filterFields = filterableFields({ appId: 'fleet', fields: schema });
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [tpcOnly, setTpcOnly] = useState(false);
  const [selected, setSelected] = useState<Machine | null>(null);
  const [machineFormOpen, setMachineFormOpen] = useState(false);
  const [editingMachine, setEditingMachine] = useState<Machine | null>(null);
  const [modelsOpen, setModelsOpen] = useState(false);
  const archiveMachine = useArchiveMachine();
  const [initiateOpen, setInitiateOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const orgId = authUser?.orgId ?? JA_ORG_ID;
  const collectionActive = useOrgStore((s) => s.isAppActive(orgId, 'collection_note'));
  const lastHandledQuery = useRef<string | null>(null);

  // Deep links: ?fleet= / ?id= / ?qr= open the machine detail (or toast the error code).
  const fleetParam = searchParams.get('fleet') ?? undefined;
  const idParam = searchParams.get('id') ?? undefined;
  const qrParam = searchParams.get('qr') ?? undefined;
  useEffect(() => {
    if (!machines) return;
    if (!fleetParam && !idParam && !qrParam) return;
    const key = `${fleetParam ?? ''}|${idParam ?? ''}|${qrParam ?? ''}`;
    if (lastHandledQuery.current === key) return;
    lastHandledQuery.current = key;
    const res = resolveFleetQueryForCurrentOrg(
      { fleet: fleetParam, id: idParam, qr: qrParam },
      machineResolverFor(machines),
    );
    if (!res) return;
    if (res.ok) {
      const found =
        filtered.find((m) => m.id === res.machine.id) ??
        filtered.find((m) => (m.fleetNo ?? m.assetNumber) === res.machine.fleetNo);
      if (found) setSelected(found);
      else toastError(DEEP_LINK_MESSAGES.NOT_FOUND);
    } else {
      toastError(DEEP_LINK_MESSAGES[res.error] ?? `Cannot open machine (${res.error})`);
    }
  }, [machines, filtered, fleetParam, idParam, qrParam, orgId]);

  // After a save or refresh, show the latest version of the open machine (it carries the row version).
  useEffect(() => {
    setSelected((cur) => (cur ? machines?.find((m) => m.id === cur.id) ?? cur : cur));
  }, [machines]);

  // Count of machines needing TPC attention (expired or approaching expiry)
  const tpcAttentionCount = useMemo(
    () => filtered.filter((m) => getTPCStatus(m.tpcExpiryDate).needsAttention).length,
    [filtered]
  );

  const data = useMemo(() => {
    const byFilters = applySchemaFilters(filtered, filterFields, filterValues);
    return byFilters.filter((m) => {
      if (tpcOnly && !getTPCStatus(m.tpcExpiryDate).needsAttention) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, filterFields, filterValues, tpcOnly]);

  if (isError) {
    return <ApiErrorNotice error={error} onRetry={() => void refetch()} />;
  }

  // Freshly-activated Fleet → show setup (presets, or load-previous on reactivation).
  if (!isLoading && onboarding.showOnboarding) {
    return <AppOnboarding appId="fleet" mode={onboarding.mode} onDone={() => { onboarding.dismiss(); refetch(); }} />;
  }

  // Rich renderers for known fields; the schema decides which columns show,
  // their order, and their header label. Custom (user-added) fields fall back
  // to a generic renderer reading from the machine's `fields` bag or root.
  const RENDERERS: Record<string, (m: Machine) => React.ReactNode> = {
    assetNumber: (m) => <span className="font-medium text-foreground">{m.assetNumber}</span>,
    make: (m) => (
      <div className="flex flex-col">
        <span className="font-medium text-foreground">{m.make} {m.model}</span>
        <span className="text-xs text-muted-foreground">{m.category}</span>
      </div>
    ),
    branchName: (m) => <span className="text-muted-foreground">{m.branchName}</span>,
    status: (m) => <StatusBadge status={m.status} size="sm" />,
    currentCustomer: (m) => m.currentCustomer ? <span className="text-foreground">{m.currentCustomer}</span> : <span className="text-muted-foreground">—</span>,
    hoursOperated: (m) => <span className="tabular-nums text-muted-foreground">{formatNumber(m.hoursOperated)}h</span>,
  };

  const renderCell = (m: Machine, key: string, type: string) => {
    if (RENDERERS[key]) return RENDERERS[key](m);
    const raw = (m as any)[key] ?? (m as any).fields?.[key];
    if (raw === undefined || raw === null || raw === '') return <span className="text-muted-foreground">—</span>;
    if (type === 'currency') return <span className="tabular-nums">{formatCurrency(Number(raw))}</span>;
    if (type === 'date') return <span className="text-muted-foreground">{formatDate(String(raw))}</span>;
    if (type === 'boolean') return <span>{raw ? 'Yes' : 'No'}</span>;
    return <span className="text-foreground">{String(raw)}</span>;
  };

  const columns: Column<Machine>[] = tableFields({ appId: 'fleet', fields: schema }).map((f) => ({
    key: f.key,
    header: f.label,
    sortable: true,
    sortAccessor: (m: Machine) => String((m as any)[f.key] ?? (m as any).fields?.[f.key] ?? ''),
    render: (m: Machine) => renderCell(m, f.key, f.type),
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fleet Management"
        description={`${data.length} machines`}
        actions={
          <>
            {isOwner && (
              <Button variant="outline" size="sm" onClick={() => setCustomizeOpen(true)}>
                <Sliders className="mr-1.5 h-4 w-4" /> Customize
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setModelsOpen(true)}>Models</Button>
            <Button variant="outline" size="sm"><Download className="mr-1.5 h-4 w-4" /> Export</Button>
            <Button size="sm" onClick={() => { setEditingMachine(null); setMachineFormOpen(true); }}><Plus className="mr-1.5 h-4 w-4" /> Add Machine</Button>
          </>
        }
      />

      {/* Schema-driven filter bar (filters per filterable field) + TPC toggle */}
      <div className="flex flex-wrap items-center gap-3">
        <SchemaFilterBar
          fields={filterFields}
          values={filterValues}
          onChange={(key, value) => setFilterValues((v) => ({ ...v, [key]: value }))}
        />
        <button
          onClick={() => setTpcOnly((v) => !v)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            tpcOnly
              ? 'bg-red-600 text-white'
              : tpcAttentionCount > 0
                ? 'bg-red-100 text-red-700 hover:bg-red-200'
                : 'bg-muted text-muted-foreground hover:bg-accent'
          )}
          title="Show only machines with expiring or expired TPC certification"
        >
          <ShieldAlert className="h-3.5 w-3.5" />
          TPC due {tpcAttentionCount > 0 && `(${tpcAttentionCount})`}
        </button>
      </div>

      {isLoading ? <LoadingState /> : (
        <DataTable
          columns={columns}
          data={data}
          searchable
          searchPlaceholder="Search by asset number, make, model..."
          searchKeys={['assetNumber', 'make', 'model', 'serialNumber', 'currentCustomer']}
          onRowClick={(m) => setSelected(m)}
          rowKey={(m) => m.id}
          pageSize={15}
        />
      )}

      {/* Machine Detail Drawer */}
      <SlideOver
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.make} ${selected.model}` : ''}
        description={selected ? `${selected.assetNumber} · ${selected.branchName}` : ''}
        width="xl"
        footer={
          <div className="flex flex-wrap gap-2">
            {selected && (
              <Button variant="outline" size="sm" onClick={() => { setEditingMachine(selected); setMachineFormOpen(true); }}>Edit</Button>
            )}
            {selected && selected.status !== 'Offline' && (
              <Button
                variant="outline" size="sm" disabled={archiveMachine.isPending}
                title="Archived machines are kept, never deleted"
                onClick={() => archiveMachine.mutate(
                  { id: selected.id, rowVersion: selected.rowVersion ?? 0 },
                  { onSuccess: () => { toastSuccess('Machine archived'); setSelected(null); }, onError: (err) => { toastError(errorText(err)); void refetch(); } },
                )}
              >
                Archive
              </Button>
            )}
            <Button variant="outline" size="sm" className="flex-1"><Wrench className="mr-1.5 h-4 w-4" /> Send to Workshop</Button>
            <Button size="sm" className="flex-1"><Calendar className="mr-1.5 h-4 w-4" /> New Booking</Button>
            {selected && canInitiate(
              selected.status,
              collectionActive,
            ) && (
              <Button variant="outline" size="sm" className="w-full" onClick={() => setInitiateOpen(true)}>
                Initiate Off-Hire / Collection
              </Button>
            )}
          </div>
        }
      >
        {selected && (
          <>
            <MachineQrPanel machine={toMachineLite(selected, orgId)} />
            <MachineDetail machine={selected} />
          </>
        )}
      </SlideOver>

      {selected && (
        <InitiateDialog
          open={initiateOpen}
          onOpenChange={setInitiateOpen}
          preselectMachineId={selected.id}
          onCreated={(r) => { if (r.cn) toastSuccess(`Created ${r.cn.number}`); }}
        />
      )}

      <MachineApiFormDialog
        open={machineFormOpen}
        machine={editingMachine}
        onClose={() => { setMachineFormOpen(false); setEditingMachine(null); }}
      />
      <MachineModelsDialog open={modelsOpen} onClose={() => setModelsOpen(false)} />

      <SchemaCustomizer appId="fleet" open={customizeOpen} onClose={() => setCustomizeOpen(false)} />
    </div>
  );
}

function MachineDetail({ machine }: { machine: Machine }) {
  const c = getStatusColor(machine.status);
  return (
    <div className="space-y-1">
      <div className="mb-4 flex items-center gap-3">
        <div className={cn('flex h-14 w-14 items-center justify-center rounded-xl', c.bg, c.text)}>
          <Forklift className="h-7 w-7" />
        </div>
        <div>
          <StatusBadge status={machine.status} />
          <p className="mt-1 text-xs text-muted-foreground">{machine.category} · {machine.powerSource}</p>
        </div>
      </div>

      <SectionTitle>Hire Details (REF-09)</SectionTitle>
      <InfoGrid columns={3}>
        <InfoRow label="Fleet No" value={(machine as any).fleetNo ?? machine.assetNumber} />
        <InfoRow label="Type" value={(machine as any).type ?? '—'} />
        <InfoRow label="Energy" value={(machine as any).energy ?? '—'} />
        <InfoRow label="WH (Working Height)" value={`${(machine as any).wh ?? machine.workingHeight}m`} />
        <InfoRow label="Site" value={(machine as any).siteRegion ?? machine.location} />
        <InfoRow label="Specific" value={(machine as any).specific ?? 'Yard'} />
        <InfoRow label="Client" value={(machine as any).client ?? machine.currentCustomer ?? '—'} />
        <InfoRow label="Rate (AED)" value={(machine as any).rate ? `AED ${(machine as any).rate?.toLocaleString()}` : '—'} />
        <InfoRow label="Period" value={(machine as any).period ?? '—'} />
        <InfoRow label="Daily Revenue" value={(machine as any).dailyRevenue ? `AED ${(machine as any).dailyRevenue}` : '—'} />
        <InfoRow label="H/A" value={(machine as any).ha ?? '—'} />
        <InfoRow label="REP" value={(machine as any).rep ?? '—'} />
        <InfoRow label="PT" value={(machine as any).pt ?? '—'} />
        <InfoRow label="LPO" value={(machine as any).lpo ?? '—'} />
        <InfoRow label="LPO Validity" value={(machine as any).lpoValidity ? formatDate((machine as any).lpoValidity) : '—'} />
      </InfoGrid>

      <SectionTitle>TPC Certificate (Third Party Certification)</SectionTitle>
      <div className="mb-2 flex items-center gap-2">
        <TPCBadge tpcExpiryDate={machine.tpcExpiryDate} />
        {getTPCStatus(machine.tpcExpiryDate).needsAttention && (
          <span className="text-xs text-muted-foreground">
            Renewal required — ops/workshop to chase certifying supplier
          </span>
        )}
      </div>
      <InfoGrid columns={3}>
        <InfoRow label="TPC Expiry" value={machine.tpcExpiryDate ? formatDate(machine.tpcExpiryDate) : '—'} />
        <InfoRow label="TPC Supplier" value={machine.tpcSupplier ?? '—'} />
        <InfoRow label="DOA" value={(machine as any).doa ? formatDate((machine as any).doa) : '—'} />
      </InfoGrid>

      <SectionTitle>Repair Economics</SectionTitle>
      <InfoGrid columns={3}>
        <InfoRow label="Hours to Repair" value={(machine as any).hoursToRepair ? `${(machine as any).hoursToRepair}h` : '—'} />
        <InfoRow label="Cost to Repair" value={(machine as any).costToRepair ? `AED ${(machine as any).costToRepair?.toLocaleString()}` : '—'} />
        <InfoRow label="Pay Back" value={(machine as any).payBack ? `${(machine as any).payBack} months` : '—'} />
      </InfoGrid>

      <SectionTitle>Specifications</SectionTitle>
      <InfoGrid columns={3}>
        <InfoRow label="Asset Number" value={machine.assetNumber} />
        <InfoRow label="Serial Number" value={machine.serialNumber} />
        <InfoRow label="Year" value={machine.year} />
        <InfoRow label="Make / Model" value={`${machine.make} ${machine.model}`} />
        <InfoRow label="Platform Height" value={`${machine.platformHeight}m`} />
        <InfoRow label="Working Height" value={`${machine.workingHeight}m`} />
        <InfoRow label="Capacity" value={`${machine.capacity}kg`} />
        <InfoRow label="Power Source" value={machine.powerSource} />
        <InfoRow label="Hours Operated" value={`${formatNumber(machine.hoursOperated)}h`} />
      </InfoGrid>

      <SectionTitle>Location & Assignment</SectionTitle>
      <InfoGrid columns={2}>
        <InfoRow label="Branch" value={machine.branchName} />
        <InfoRow label="Current Location" value={
          <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-muted-foreground" />{machine.location}</span>
        } />
        <InfoRow label="Current Customer" value={machine.currentCustomer ?? 'Not on hire'} />
        <InfoRow label="Booking Reference" value={machine.currentBookingId ?? '—'} />
      </InfoGrid>

      <SectionTitle>Inspection Schedule</SectionTitle>
      <InfoGrid columns={3}>
        <InfoRow label="Last Inspection" value={formatDate(machine.lastInspection)} />
        <InfoRow label="Next Inspection" value={
          <span className={daysUntil(machine.nextInspection) < 7 ? 'text-rose-600 dark:text-rose-400 font-medium' : ''}>
            {formatDate(machine.nextInspection)} ({daysUntil(machine.nextInspection)}d)
          </span>
        } />
        <InfoRow label="Next PHI" value={formatDate(machine.nextPHI)} />
        <InfoRow label="Next Mandatory" value={formatDate(machine.nextMandatory)} />
      </InfoGrid>

      <SectionTitle>Repair History</SectionTitle>
      {machine.repairHistory.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">No repair records.</p>
      ) : (
        <div className="space-y-2">
          {machine.repairHistory.map((r) => (
            <Card key={r.id} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{r.description}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{r.technician} · {r.bay} · {formatDate(r.date)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-foreground">{formatCurrency(r.cost)}</p>
                  <p className="text-xs text-muted-foreground">{r.durationHours}h</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <MachineStatusPanel machine={machine} />

      <MachineDocumentsSection machineId={machine.id} />

      <SectionTitle>Activity Timeline</SectionTitle>
      <Timeline events={machine.timeline} compact />
    </div>
  );
}

/** Audited manual status override. The server requires a reason and accepts the reserved statuses only here. */
function MachineStatusPanel({ machine }: { machine: Machine }) {
  const setStatus = useSetMachineStatus();
  const [status, setLocalStatus] = useState<string>(machine.status);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="mt-4 space-y-2 rounded-md border border-border p-3" data-testid="machine-status-panel">
      <p className="text-sm font-medium">Set status manually</p>
      {error != null && <ApiErrorNotice error={error} />}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select
          aria-label="New status" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          value={status} onChange={(e) => setLocalStatus(e.target.value)}
        >
          {OPERATIONAL_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
        <input
          aria-label="Reason" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        />
        <Button
          size="sm" disabled={setStatus.isPending || status === machine.status || !reason.trim()}
          onClick={() => {
            setError(null);
            setStatus.mutate(
              { id: machine.id, rowVersion: machine.rowVersion ?? 0, input: { operationalStatus: status as Machine['status'], reason: reason.trim() } },
              { onSuccess: () => { toastSuccess('Status updated'); setReason(''); }, onError: setError },
            );
          }}
        >
          Apply
        </Button>
      </div>
    </div>
  );
}
