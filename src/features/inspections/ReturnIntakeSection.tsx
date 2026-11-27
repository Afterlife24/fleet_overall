import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, ClipboardCheck, ShieldCheck, XCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/common/StatusBadge';
import { SlideOver } from '@/components/common/SlideOver';
import { LoadingState } from '@/components/common/EmptyState';
import { ApiErrorNotice, ApiSessionGate } from '@/components/common/ApiStatus';
import {
  useAttachInspectionPhoto, useCan, useInspectionDetail, useInspectionEvidence, useReleaseIntakeHold, useReturnIntakes,
  useSaveInspectionResults, useSubmitInspection, useUpdateInspection,
} from '@/hooks/api/useGateApi';
import type { InspectionAnswer, InspectionDto, InspectionResultDto, ReleaseHoldResultDto } from '@/services/api/gate';
import { toastSuccess } from '@/lib/toast-helper';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/utils/format';

type Choice = 'Pass' | 'Fail' | 'N/A';
const CHOICES: Choice[] = ['Pass', 'Fail', 'N/A'];
const PHOTO_ROLES = ['FRONT', 'BACK', 'LEFT', 'RIGHT', 'DEFECT', 'OTHER'] as const;

interface Answer { result: InspectionAnswer; notes: string }

/** Items the server requires before a submit: required or critical and still unanswered. */
export function unansweredRequired(results: readonly InspectionResultDto[], answers: Record<string, Answer>): string[] {
  return results
    .filter((r) => (r.required || r.critical) && (answers[r.itemKey]?.result ?? r.result) === 'Pending')
    .map((r) => r.itemKey);
}

const isOpen = (i: Pick<InspectionDto, 'status'>) => i.status === 'Pending' || i.status === 'In Progress';
export const holdIsActive = (i: Pick<InspectionDto, 'status' | 'holdReleasedAt'>) =>
  (i.status === 'Passed' || i.status === 'Failed') && !i.holdReleasedAt;

/** RETURN INTAKE inspections created by Gate IN completion. Shown at the top of the PHI page; reads `/api/v1/inspections`. */
export function ReturnIntakeSection() {
  return (
    <ApiSessionGate>
      <ReturnIntakeList />
    </ApiSessionGate>
  );
}

function ReturnIntakeList() {
  const intakes = useReturnIntakes();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const items = intakes.data ?? [];
  const openCount = items.filter((i) => isOpen(i) || holdIsActive(i)).length;

  return (
    <Card className="p-4" data-testid="return-intake-section">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-sky-600" />
          <h3 className="text-sm font-semibold">Return Intake (from Gate IN)</h3>
        </div>
        <span className="text-xs text-muted-foreground">{openCount} need attention</span>
      </div>
      {intakes.isError && <ApiErrorNotice error={intakes.error} onRetry={() => void intakes.refetch()} />}
      {intakes.isLoading && <LoadingState />}
      {intakes.data && items.length === 0 && (
        <p className="text-sm text-muted-foreground">No return intake inspections yet. One is created when a Gate IN return is completed.</p>
      )}
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5">Reference</th><th className="px-2 py-1.5">Fleet No</th><th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5">Result</th><th className="px-2 py-1.5">Hold</th><th className="px-2 py-1.5">Created</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/20" onClick={() => setSelectedId(i.id)}>
                  <td className="px-2 py-2 font-medium">{i.reference}</td>
                  <td className="px-2 py-2">{i.fleetNo}</td>
                  <td className="px-2 py-2"><StatusBadge status={i.status} size="sm" /></td>
                  <td className="px-2 py-2 text-xs">{i.overallResult ?? '—'}</td>
                  <td className="px-2 py-2 text-xs">{i.holdReleasedAt ? 'Released' : holdIsActive(i) ? 'On hold' : 'On hold (open)'}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">{formatDateTime(i.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ReturnIntakePanel id={selectedId} onClose={() => setSelectedId(null)} />
    </Card>
  );
}

interface PanelProps { id: string | null; onClose: () => void }

/** The checklist from the server results: Pass/Fail/N/A with notes, hours, fuel, photos, submit and hold release. */
export function ReturnIntakePanel({ id, onClose }: PanelProps) {
  const detail = useInspectionDetail(id);
  const evidence = useInspectionEvidence(id);
  const canWrite = useCan('inspections.write');
  const canRelease = useCan('inspections.release_hold');
  const saveResults = useSaveInspectionResults();
  const update = useUpdateInspection();
  const submit = useSubmitInspection();
  const release = useReleaseIntakeHold();
  const attach = useAttachInspectionPhoto();

  const insp = detail.data;
  const results = useMemo(() => insp?.results ?? [], [insp?.results]);

  // Local edits. Server values fill in everything the user has not touched, so "Reload latest" keeps typed input.
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const touched = useRef(new Set<string>());
  const [hours, setHours] = useState('');
  const [fuel, setFuel] = useState('');
  const [notes, setNotes] = useState('');
  const headerTouched = useRef({ hours: false, fuel: false, notes: false });
  const [error, setError] = useState<unknown>(null);
  const [role, setRole] = useState<(typeof PHOTO_ROLES)[number]>('FRONT');
  const [reason, setReason] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [releaseOutcome, setReleaseOutcome] = useState<ReleaseHoldResultDto['machine'] | null>(null);
  const currentId = useRef<string | null>(null);

  useEffect(() => {
    if (id !== currentId.current) {
      currentId.current = id;
      touched.current = new Set();
      headerTouched.current = { hours: false, fuel: false, notes: false };
      setAnswers({});
      setError(null);
      setReason('');
      setReviewed(false);
      setReleaseOutcome(null);
    }
  }, [id]);

  useEffect(() => {
    if (!insp) return;
    setAnswers((prev) => {
      const next: Record<string, Answer> = {};
      for (const r of insp.results ?? []) {
        next[r.itemKey] = touched.current.has(r.itemKey) && prev[r.itemKey] ? prev[r.itemKey] : { result: r.result, notes: r.notes ?? '' };
      }
      return next;
    });
    if (!headerTouched.current.hours) setHours(insp.machineHours ?? '');
    if (!headerTouched.current.fuel) setFuel(insp.fuelPercent ?? '');
    if (!headerTouched.current.notes) setNotes(insp.notes ?? '');
  }, [insp]);

  const editable = !!insp && isOpen(insp) && canWrite;
  const missing = insp ? unansweredRequired(results, answers) : [];
  const busy = saveResults.isPending || update.isPending || submit.isPending;

  const setAnswer = (key: string, patch: Partial<Answer>) => {
    touched.current.add(key);
    setAnswers((a) => ({ ...a, [key]: { result: a[key]?.result ?? 'Pending', notes: a[key]?.notes ?? '', ...patch } }));
  };

  /** Writes touched answers and header fields, chaining the row version. Returns the latest inspection. */
  const persist = async (): Promise<InspectionDto> => {
    let current = insp as InspectionDto;
    const changed = results
      .filter((r) => touched.current.has(r.itemKey) && answers[r.itemKey] && answers[r.itemKey].result !== 'Pending')
      .map((r) => ({ itemKey: r.itemKey, result: answers[r.itemKey].result as Choice, notes: answers[r.itemKey].notes.trim() || null }));
    if (changed.length > 0) {
      current = await saveResults.mutateAsync({ id: current.id, rowVersion: current.rowVersion, results: changed });
      touched.current = new Set();
    }
    const patch: { machineHours?: string | null; fuelPercent?: string | null; notes?: string | null; start?: boolean } = {};
    if (headerTouched.current.hours) patch.machineHours = hours.trim() || null;
    if (headerTouched.current.fuel) patch.fuelPercent = fuel.trim() || null;
    if (headerTouched.current.notes) patch.notes = notes.trim() || null;
    if (Object.keys(patch).length > 0) {
      current = await update.mutateAsync({ id: current.id, rowVersion: current.rowVersion, patch });
      headerTouched.current = { hours: false, fuel: false, notes: false };
    }
    return current;
  };

  const onSave = async () => {
    setError(null);
    try {
      await persist();
      toastSuccess('Intake checklist saved');
    } catch (err) {
      setError(err);
    }
  };

  const onSubmit = async () => {
    setError(null);
    try {
      const current = await persist();
      const done = await submit.mutateAsync({ id: current.id, rowVersion: current.rowVersion });
      toastSuccess(done.status === 'Passed' ? 'Intake passed. The machine stays on hold until a supervisor releases it.' : 'Intake failed. The machine stays blocked.');
    } catch (err) {
      setError(err);
    }
  };

  const onRelease = async () => {
    if (!insp) return;
    setError(null);
    try {
      const out = await release.mutateAsync({ id: insp.id, rowVersion: insp.rowVersion, reason: reason.trim(), evidenceReviewed: reviewed });
      setReleaseOutcome(out.machine);
      toastSuccess(out.machine.released ? 'Intake hold released. The machine is ready.' : 'Intake hold released. The machine still has blockers.');
    } catch (err) {
      setError(err);
    }
  };

  const onPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !insp) return;
    setError(null);
    attach.mutate({ inspectionId: insp.id, file, photoRole: role }, { onSuccess: () => toastSuccess('Photo attached') });
  };

  const sections = useMemo(() => {
    const map = new Map<string, InspectionResultDto[]>();
    for (const r of results) map.set(r.section, [...(map.get(r.section) ?? []), r]);
    return [...map.entries()];
  }, [results]);

  const reload = () => { void detail.refetch(); setError(null); };
  const evidenceCount = (evidence.data ?? []).length;
  const failedAnswers = results.filter((r) => (answers[r.itemKey]?.result ?? r.result) === 'Fail').length;

  return (
    <SlideOver
      open={!!id}
      onClose={onClose}
      title={insp ? insp.reference : 'Return intake'}
      description={insp ? `${insp.fleetNo} · ${insp.inspectionType} · ${insp.checklistVersion}` : ''}
      width="xl"
      footer={editable ? (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" disabled={busy} onClick={() => void onSave()}>Save Draft</Button>
          <Button size="sm" className="flex-1" disabled={busy || missing.length > 0} onClick={() => void onSubmit()}>
            {submit.isPending ? 'Submitting...' : 'Submit intake'}
          </Button>
        </div>
      ) : undefined}
    >
      {detail.isLoading && <LoadingState />}
      {detail.isError && <ApiErrorNotice error={detail.error} onRetry={() => void detail.refetch()} />}
      {insp && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={insp.status} />
            {insp.overallResult && <StatusBadge status={insp.overallResult === 'Pass' ? 'Passed' : 'Failed'} size="sm" />}
            {insp.holdReleasedAt
              ? <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" />Hold released {formatDateTime(insp.holdReleasedAt)}</span>
              : <span className="inline-flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />Machine on intake hold</span>}
          </div>

          {error != null && <ApiErrorNotice error={error} onReload={reload} reloading={detail.isFetching} />}

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ri-hours">Machine hours</Label>
              <Input id="ri-hours" type="number" step="0.1" min="0" value={hours} disabled={!editable}
                onChange={(e) => { headerTouched.current.hours = true; setHours(e.target.value); }} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ri-fuel">Fuel / charge %</Label>
              <Input id="ri-fuel" type="number" step="1" min="0" max="100" value={fuel} disabled={!editable}
                onChange={(e) => { headerTouched.current.fuel = true; setFuel(e.target.value); }} />
            </div>
            <div className="space-y-1">
              <Label>Photos</Label>
              <p className="flex h-9 items-center gap-1 text-sm"><Camera className="h-4 w-4" />{evidenceCount} attached</p>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ri-notes">Notes</Label>
            <Textarea id="ri-notes" rows={2} value={notes} disabled={!editable}
              onChange={(e) => { headerTouched.current.notes = true; setNotes(e.target.value); }} />
          </div>

          {sections.map(([section, items]) => (
            <div key={section}>
              <h4 className="mb-2 text-sm font-semibold">{section}</h4>
              <div className="space-y-1.5">
                {items.map((r) => {
                  const a = answers[r.itemKey] ?? { result: r.result, notes: r.notes ?? '' };
                  return (
                    <div key={r.itemKey} data-testid={`item-${r.itemKey}`} className={cn('rounded-lg border p-2.5', a.result === 'Fail' && 'border-rose-300 bg-rose-50/50')}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="min-w-0 flex-1 text-sm">
                          {r.question}
                          {r.required && <span className="ml-1 text-rose-600" title="Required">*</span>}
                          {r.critical && (
                            <span className="ml-2 inline-flex items-center gap-0.5 text-[10px] font-semibold text-rose-600"><AlertTriangle className="h-3 w-3" />Critical</span>
                          )}
                        </p>
                        <div role="radiogroup" aria-label={r.question} className="flex gap-1">
                          {CHOICES.map((c) => {
                            const disabled = !editable || (c === 'N/A' && r.critical);
                            return (
                              <Button
                                key={c}
                                type="button"
                                size="sm"
                                role="radio"
                                aria-checked={a.result === c}
                                disabled={disabled}
                                variant={a.result === c ? (c === 'Fail' ? 'destructive' : 'default') : 'outline'}
                                className="h-7 px-2 text-xs"
                                onClick={() => setAnswer(r.itemKey, { result: c })}
                              >
                                {c}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                      {(a.result === 'Fail' || a.notes) && (
                        <Input className="mt-2 h-8 text-xs" placeholder="Notes" aria-label={`Notes for ${r.question}`} value={a.notes} disabled={!editable}
                          onChange={(e) => setAnswer(r.itemKey, { notes: e.target.value })} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {editable && missing.length > 0 && (
            <p role="status" className="text-xs text-amber-700">{missing.length} required or critical item(s) still need an answer before you can submit.</p>
          )}
          {editable && failedAnswers > 0 && (
            <p role="status" className="text-xs text-rose-700">A Fail on a required or critical item fails the intake and blocks the machine.</p>
          )}

          <div className="space-y-2 rounded-md border p-3">
            <h4 className="flex items-center gap-1 text-sm font-semibold"><Camera className="h-4 w-4" />Evidence photos</h4>
            {(evidence.data ?? []).length > 0 && (
              <ul className="list-disc pl-5 text-sm">
                {(evidence.data ?? []).map((e) => <li key={e.id}>{e.originalName} <span className="text-xs text-muted-foreground">({e.photoRole})</span></li>)}
              </ul>
            )}
            {canWrite && (isOpen(insp) || holdIsActive(insp)) && (
              <div className="flex flex-wrap items-center gap-2">
                <Select value={role} onValueChange={(v) => setRole(v as (typeof PHOTO_ROLES)[number])}>
                  <SelectTrigger className="h-9 w-32" aria-label="Photo role"><SelectValue /></SelectTrigger>
                  <SelectContent>{PHOTO_ROLES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="file" accept="image/png,image/jpeg" capture="environment" className="h-9 max-w-xs" disabled={attach.isPending} onChange={onPhoto} aria-label="Attach evidence photo" />
              </div>
            )}
            {attach.isPending && <p className="text-xs text-muted-foreground">Uploading and checking the photo...</p>}
            {attach.isError && <ApiErrorNotice error={attach.error} />}
          </div>

          {canRelease && holdIsActive(insp) && (
            <div className="space-y-2 rounded-md border border-sky-200 bg-sky-50/50 p-3" data-testid="release-hold">
              <h4 className="flex items-center gap-1 text-sm font-semibold"><ShieldCheck className="h-4 w-4" />Release intake hold</h4>
              <p className="text-xs text-muted-foreground">
                {insp.status === 'Failed'
                  ? 'This intake failed. Confirm you reviewed the evidence (or attach photos) before releasing.'
                  : 'The intake passed. Releasing makes the machine ready unless other blockers remain.'}
              </p>
              <Textarea rows={2} placeholder="Reason (required)" aria-label="Release reason" value={reason} onChange={(e) => setReason(e.target.value)} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
                I have reviewed the evidence
              </label>
              <Button size="sm" disabled={!reason.trim() || (insp.status === 'Failed' && !reviewed && evidenceCount < 1) || release.isPending} onClick={() => void onRelease()}>
                {release.isPending ? 'Releasing...' : 'Release intake hold'}
              </Button>
            </div>
          )}
          {insp.holdReleasedAt && (
            <p className="text-sm text-muted-foreground">Released {formatDateTime(insp.holdReleasedAt)}: {insp.holdReleaseReason}</p>
          )}
          {releaseOutcome && (
            <p role="status" className={cn('flex items-start gap-1 text-sm', releaseOutcome.released ? 'text-emerald-700' : 'text-amber-700')}>
              {releaseOutcome.released ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <XCircle className="mt-0.5 h-4 w-4" />}
              {releaseOutcome.released ? `Machine is ${releaseOutcome.readinessStatus}.` : `Machine stays ${releaseOutcome.readinessStatus}. Blockers: ${releaseOutcome.blockers.join(', ') || 'none listed'}.`}
            </p>
          )}
        </div>
      )}
    </SlideOver>
  );
}
