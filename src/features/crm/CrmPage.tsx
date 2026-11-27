import { useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { KPICard } from '@/components/common/KPICard';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore, JA_ORG_ID } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { ApiErrorNotice, ApiSessionGate, errorText } from '@/components/common/ApiStatus';
import { LoadingState } from '@/components/common/EmptyState';
import {
  useChangePhase, useCreateQuotation, useCrmData, useCustomerRecords, useQuotationHistory,
} from '@/hooks/useApiResources';
import { newSubmissionId } from '@/services/api/idempotency';
import { phaseToApi } from '@/services/api/mappers';
import { useSessionStore } from '@/services/api/session';
import { formatCurrency, formatDate } from '@/utils/format';
import { toastError, toastSuccess } from '@/lib/toast-helper';
import { cn } from '@/lib/utils';
import { Plus, Receipt, RotateCcw, ThumbsDown, Trophy, ArrowRight } from 'lucide-react';
import type { Quotation, QuotationPhase } from '@/types/quotation';
import { DEFAULT_LOST_REASONS, PHASES } from '@/types/quotation';
import { PipelineBoard } from './PipelineBoard';
import { planPhaseRequest } from './statusPanelCore';
import {
  byPhase, filterList, pipelineOf, pipelineTotals, searchLost, toInvoicePrefill,
} from './crmRules';
import {
  NewQuotationDialog, PhaseBadge, QuotationDetail, ReasonDialog, type SaveResult,
} from './CrmShared';

type Tab = 'pipeline' | 'list' | 'lost' | 'won';

function tabFromPath(path: string): Tab {
  if (path.startsWith('/crm/lost')) return 'lost';
  if (path.startsWith('/crm/won')) return 'won';
  return 'pipeline';
}

/** CRM pipeline and Status panel. Reads and writes `/api/v1/quotations`; waits for the API session. */
export function CrmPage() {
  return (
    <ApiSessionGate>
      <CrmScreen />
    </ApiSessionGate>
  );
}

function CrmScreen() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const orgId = user?.orgId ?? JA_ORG_ID;
  const userName = user?.name ?? 'Unknown';
  const isAppActive = useOrgStore((s) => s.isAppActive);
  const invoiceActive = isAppActive(orgId, 'invoice');

  const crm = useCrmData();
  const customers = useCustomerRecords();
  const createQuotation = useCreateQuotation();
  const changePhase = useChangePhase();
  const all = crm.data?.quotations;
  const quotations = useMemo(() => (all ?? []).filter((q) => q.orgId === orgId), [all, orgId]);
  // One submission id per (quotation, from, to) change: a retry of the same change reuses its Idempotency-Key.
  const submissions = useRef(new Map<string, string>());
  const createSubmission = useRef(newSubmissionId());

  const routeTab = tabFromPath(pathname);
  const [pipelineView, setPipelineView] = useState<'pipeline' | 'list'>('pipeline');
  const tab: Tab = routeTab === 'pipeline' ? pipelineView : routeTab;

  const [detailId, setDetailId] = useState<string | null>(null);
  const [lostTarget, setLostTarget] = useState<Quotation | null>(null);
  const [reopenTarget, setReopenTarget] = useState<Quotation | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const detail = quotations.find((q) => q.id === detailId) ?? null;
  const history = useQuotationHistory(detailId);
  const totals = pipelineTotals(quotations);

  /** The only caller of changePhase. Shared by the Status panel, drag and drop and the reason dialogs. */
  const move = async (q: Quotation, to: QuotationPhase, reason?: string): Promise<SaveResult> => {
    const key = `${q.id}:${q.phase}:${to}`;
    let submissionId = submissions.current.get(key);
    if (!submissionId) { submissionId = newSubmissionId(); submissions.current.set(key, submissionId); }
    try {
      await changePhase.mutateAsync({
        id: q.id, rowVersion: q.rowVersion ?? 0, submissionId,
        input: { toPhase: phaseToApi(to), ...(reason ? { reason } : {}) },
      });
      submissions.current.delete(key);
      toastSuccess(`${q.opportunity} moved to ${to}`);
      return { ok: true };
    } catch (error) {
      toastError(errorText(error));
      return { ok: false, error };
    }
  };

  const dropPhase = (q: Quotation, to: QuotationPhase) => {
    const req = planPhaseRequest(q.phase, to);
    if (req.kind === 'reject') toastError(req.error);
    else if (req.kind === 'needsReason') (req.label === 'Lost' ? setLostTarget : setReopenTarget)(q);
    else void move(q, to);
  };

  const proceedToInvoice = (q: Quotation) =>
    navigate('/docs/invoice', { state: { prefill: toInvoicePrefill(q) } });

  const TabBtn = ({ id, label, count, to }: { id: Tab; label: string; count: number; to: string }) => (
    <button
      onClick={() => {
        if (id === 'pipeline' || id === 'list') { setPipelineView(id); if (routeTab !== 'pipeline') navigate(to); }
        else navigate(to);
      }}
      className={cn(
        'rounded-md px-3 py-1.5 text-sm font-medium',
        tab === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
      )}
    >
      {label} <span className="ml-1 text-xs opacity-80">{count}</span>
    </button>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="CRM"
        description="Quotation pipeline: Awaiting, Tender, Lost and Won"
        actions={<Button onClick={() => setNewOpen(true)}><Plus className="mr-1 h-4 w-4" />New quotation</Button>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPICard label="Active pipeline" value={totals.count} icon={ArrowRight} color="blue" />
        <KPICard label="Pipeline value" value={formatCurrency(totals.amount)} icon={Receipt} color="purple" />
        <KPICard label="Won" value={byPhase(quotations, 'Won').length} icon={Trophy} color="green" />
        <KPICard label="Lost" value={byPhase(quotations, 'Lost').length} icon={ThumbsDown} color="red" />
      </div>

      <div className="flex flex-wrap gap-1">
        <TabBtn id="pipeline" label="Pipeline" count={pipelineOf(quotations).length} to="/crm" />
        <TabBtn id="list" label="List" count={quotations.length} to="/crm" />
        <TabBtn id="lost" label="Lost" count={byPhase(quotations, 'Lost').length} to="/crm/lost" />
        <TabBtn id="won" label="Won" count={byPhase(quotations, 'Won').length} to="/crm/won" />
      </div>

      {crm.isError && <ApiErrorNotice error={crm.error} onRetry={() => void crm.refetch()} />}
      {crm.isLoading && <LoadingState />}

      {!crm.isLoading && !crm.isError && tab === 'pipeline' && (
        <PipelineBoard
          quotations={quotations}
          selectedId={detailId}
          onSelect={(q) => setDetailId(q.id)}
          onDropPhase={dropPhase}
        />
      )}
      {!crm.isLoading && !crm.isError && tab === 'list' && <ListView quotations={quotations} onOpen={(q) => setDetailId(q.id)} />}
      {!crm.isLoading && !crm.isError && tab === 'lost' && (
        <LostView quotations={quotations} onOpen={(q) => setDetailId(q.id)} onReopen={setReopenTarget} />
      )}
      {!crm.isLoading && !crm.isError && tab === 'won' && (
        <WonView
          quotations={quotations} invoiceActive={invoiceActive}
          onOpen={(q) => setDetailId(q.id)} onInvoice={proceedToInvoice}
        />
      )}

      <QuotationDetail
        q={detail} onClose={() => setDetailId(null)}
        history={history.data} historyLoading={history.isLoading}
        statusEditor={detail ? { onSave: (to, reason) => move(detail, to, reason), onReload: () => void crm.refetch(), reloading: crm.isFetching } : undefined}
      />
      <ReasonDialog
        open={!!lostTarget} title="Mark as Lost" description={lostTarget?.number}
        submitLabel="Mark Lost" presets={DEFAULT_LOST_REASONS}
        onClose={() => setLostTarget(null)}
        onSubmit={(reason) => { if (lostTarget) void move(lostTarget, 'Lost', reason).then((r) => { if (r.ok) setLostTarget(null); }); }}
      />
      <ReasonDialog
        open={!!reopenTarget} title="Reopen quotation" description={reopenTarget?.number}
        submitLabel="Reopen"
        onClose={() => setReopenTarget(null)}
        onSubmit={(reason) => { if (reopenTarget) void move(reopenTarget, 'Awaiting', reason).then((r) => { if (r.ok) setReopenTarget(null); }); }}
      />
      <NewQuotationDialog
        open={newOpen} customers={(customers.data ?? []).filter((c) => c.status === 'Active')} salesperson={userName}
        onClose={() => setNewOpen(false)}
        onCreate={async (d) => {
          try {
            const q = await createQuotation.mutateAsync({
              submissionId: createSubmission.current,
              body: {
                customerId: d.customerId, opportunity: d.opportunity, email: d.email ?? null, amount: d.amount,
                validUntil: d.validUntil ?? null, notes: d.notes ?? null,
                salesUserId: useSessionStore.getState().session?.user.id ?? null,
              },
            });
            createSubmission.current = newSubmissionId();
            toastSuccess(`${q.opportunity} created (${q.quotationNo})`);
            setNewOpen(false);
            return { ok: true };
          } catch (error) {
            return { ok: false, error };
          }
        }}
      />
    </div>
  );
}

// ── List view ───────────────────────────────────────────────────────────────

// Same layout as the Odoo CRM list: Opportunity, Hire Agreement No., Contact, Email, Salesperson, Revenue, Stage.
const baseColumns: Column<Quotation>[] = [
  { key: 'opportunity', header: 'Opportunity', sortable: true, render: (r) => <span className="font-medium">{r.opportunity}</span> },
  { key: 'hireAgreementNo', header: 'Hire Agreement No.', sortable: true, render: (r) => <span className="font-mono text-xs">{r.hireAgreementNo}</span> },
  { key: 'customerName', header: 'Contact Name', sortable: true },
  { key: 'email', header: 'Email', render: (r) => <span className="text-muted-foreground">{r.email ?? ''}</span> },
  { key: 'salesRep', header: 'Salesperson' },
  { key: 'amount', header: 'Expected Revenue', sortable: true, sortAccessor: (r) => r.amount, render: (r) => <span className="tabular-nums">{formatCurrency(r.amount, r.currency)}</span> },
];
function ListView({ quotations, onOpen }: { quotations: Quotation[]; onOpen: (q: Quotation) => void }) {
  const [phase, setPhase] = useState<QuotationPhase | 'All'>('All');
  const [text, setText] = useState('');
  const rows = filterList(quotations, phase, text);
  const cols: Column<Quotation>[] = [
    ...baseColumns,
    { key: 'phase', header: 'Stage', sortable: true, render: (r) => <PhaseBadge phase={r.phase} /> },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search quotations" value={text} onChange={(e) => setText(e.target.value)} />
        <select
          className="rounded-md border border-input bg-background px-3 text-sm"
          value={phase} onChange={(e) => setPhase(e.target.value as QuotationPhase | 'All')}
        >
          <option value="All">All stages</option>
          {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <DataTable columns={cols} data={rows} onRowClick={onOpen} rowKey={(r) => r.id} emptyMessage="No quotations match." />
    </div>
  );
}

// ── Lost tab ────────────────────────────────────────────────────────────────

function LostView({
  quotations, onOpen, onReopen,
}: { quotations: Quotation[]; onOpen: (q: Quotation) => void; onReopen: (q: Quotation) => void }) {
  const [text, setText] = useState('');
  const rows = searchLost(quotations, text);
  const noneLost = byPhase(quotations, 'Lost').length === 0;
  const cols: Column<Quotation>[] = [
    ...baseColumns,
    { key: 'lostReason', header: 'Lost reason' },
    { key: 'lostAt', header: 'Date lost', sortable: true, sortAccessor: (r) => r.lostAt ?? '', render: (r) => (r.lostAt ? formatDate(r.lostAt) : '—') },
    { key: 'lostBy', header: 'Lost by' },
    {
      key: 'actions', header: '',
      render: (r) => (
        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onReopen(r); }}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" />Reopen
        </Button>
      ),
    },
  ];
  return (
    <div className="space-y-3">
      <Input className="max-w-xs" placeholder="Search lost quotations" value={text} onChange={(e) => setText(e.target.value)} />
      <DataTable
        columns={cols} data={rows} onRowClick={onOpen} rowKey={(r) => r.id}
        emptyMessage={noneLost ? 'No lost quotations yet.' : 'No lost quotations match your search.'}
      />
    </div>
  );
}

// ── Won view ────────────────────────────────────────────────────────────────

function WonView({
  quotations, invoiceActive, onOpen, onInvoice,
}: { quotations: Quotation[]; invoiceActive: boolean; onOpen: (q: Quotation) => void; onInvoice: (q: Quotation) => void }) {
  const rows = byPhase(quotations, 'Won');
  const cols: Column<Quotation>[] = [
    ...baseColumns,
    { key: 'updatedAt', header: 'Won on', sortable: true, render: (r) => formatDate(r.updatedAt) },
    {
      key: 'actions', header: '',
      render: (r) => (
        <Button
          size="sm" variant="outline" disabled={!invoiceActive}
          title={invoiceActive ? undefined : 'Activate the Invoice app'}
          onClick={(e) => { e.stopPropagation(); onInvoice(r); }}
        >
          <Receipt className="mr-1 h-3.5 w-3.5" />Proceed to invoicing
        </Button>
      ),
    },
  ];
  return (
    <div className="space-y-3">
      {!invoiceActive && <p className="text-sm text-muted-foreground">The Invoice app must be activated to proceed to invoicing.</p>}
      <DataTable columns={cols} data={rows} onRowClick={onOpen} rowKey={(r) => r.id} emptyMessage="No won quotations yet." />
    </div>
  );
}

