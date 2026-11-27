import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiErrorNotice, describeApiError } from '@/components/common/ApiStatus';
import {
  useApiBranches, useCreateMachine, useMachineModels, useSubmission, useUpdateMachine,
} from '@/hooks/useApiResources';
import { machinesApi, type MachineCreate } from '@/services/api/machines';
import { OPERATIONAL_STATUSES, RESERVED_OPERATIONAL_STATUSES } from '../../../shared/dto/index';
import type { Machine } from '@/types/machine';
import { toastSuccess } from '@/lib/toast-helper';

const POWER_SOURCES = ['Diesel', 'Electric', 'Hybrid', 'Bi-Energy'];
const CREATE_STATUSES = OPERATIONAL_STATUSES.filter((s) => !(RESERVED_OPERATIONAL_STATUSES as readonly string[]).includes(s));

interface FormState {
  fleetNo: string; assetNo: string; serialNo: string; modelId: string; branchId: string; currentLocation: string;
  powerSource: string; manufactureYear: string; hoursOperated: string; operationalStatus: string;
  tpcExpiresOn: string; tpcSupplier: string; lastInspectionOn: string; nextInspectionOn: string;
}

const EMPTY: FormState = {
  fleetNo: '', assetNo: '', serialNo: '', modelId: '', branchId: '', currentLocation: '', powerSource: '',
  manufactureYear: '', hoursOperated: '', operationalStatus: 'Available', tpcExpiresOn: '', tpcSupplier: '',
  lastInspectionOn: '', nextInspectionOn: '',
};

function fromMachine(m: Machine): FormState {
  return {
    fleetNo: m.fleetNo ?? m.assetNumber, assetNo: m.assetNumber, serialNo: m.serialNumber, modelId: m.modelId ?? '',
    branchId: m.branchId, currentLocation: m.location, powerSource: m.powerSource,
    manufactureYear: m.year ? String(m.year) : '', hoursOperated: String(m.hoursOperated ?? ''),
    operationalStatus: m.status, tpcExpiresOn: m.tpcExpiryDate ?? '', tpcSupplier: m.tpcSupplier ?? '',
    lastInspectionOn: m.lastInspection ?? '', nextInspectionOn: m.nextInspection ?? '',
  };
}

const REQUIRED: (keyof FormState)[] = ['fleetNo', 'assetNo', 'serialNo', 'modelId', 'branchId', 'currentLocation'];
const LABELS: Record<keyof FormState, string> = {
  fleetNo: 'Fleet No.', assetNo: 'Asset No.', serialNo: 'Serial No.', modelId: 'Model', branchId: 'Branch',
  currentLocation: 'Current location', powerSource: 'Power source', manufactureYear: 'Year', hoursOperated: 'Hours operated',
  operationalStatus: 'Status', tpcExpiresOn: 'TPC expiry', tpcSupplier: 'TPC supplier', lastInspectionOn: 'Last inspection',
  nextInspectionOn: 'Next inspection',
};
const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

interface Props { open: boolean; onClose: () => void; machine?: Machine | null }

/** Creates or edits a machine through `/api/v1/machines`. A failed save keeps the dialog open with every entered value. */
export function MachineApiFormDialog({ open, onClose, machine }: Props) {
  const isEdit = !!machine;
  const models = useMachineModels();
  const branches = useApiBranches();
  const createMachine = useCreateMachine();
  const updateMachine = useUpdateMachine();
  const submission = useSubmission();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [rowVersion, setRowVersion] = useState(0);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(machine ? fromMachine(machine) : EMPTY);
    setRowVersion(machine?.rowVersion ?? 0);
    setError(null);
    setTouched(false);
  }, [open, machine]);

  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const missing = REQUIRED.filter((k) => !form[k].trim());
  const fieldErrors = error ? describeApiError(error).fieldErrors : {};
  const pending = createMachine.isPending || updateMachine.isPending;

  const submit = async () => {
    setTouched(true);
    if (missing.length > 0) return;
    setError(null);
    const body = {
      branchId: form.branchId, modelId: form.modelId, assetNo: form.assetNo.trim(), fleetNo: form.fleetNo.trim(),
      serialNo: form.serialNo.trim(), currentLocation: form.currentLocation.trim(),
      powerSource: orNull(form.powerSource),
      manufactureYear: form.manufactureYear.trim() ? Number(form.manufactureYear) : null,
      hoursOperated: form.hoursOperated.trim() ? form.hoursOperated.trim() : undefined,
      tpcExpiresOn: orNull(form.tpcExpiresOn), tpcSupplier: orNull(form.tpcSupplier),
      lastInspectionOn: orNull(form.lastInspectionOn), nextInspectionOn: orNull(form.nextInspectionOn),
    } satisfies Partial<MachineCreate>;
    try {
      if (isEdit && machine) {
        await updateMachine.mutateAsync({ id: machine.id, rowVersion, patch: body });
        toastSuccess('Machine updated');
      } else {
        await createMachine.mutateAsync({
          body: { ...body, operationalStatus: form.operationalStatus as MachineCreate['operationalStatus'] },
          submissionId: submission.id(),
        });
        submission.renew();
        toastSuccess('Machine created');
      }
      onClose();
    } catch (err) {
      setError(err); // the form keeps what the user entered
    }
  };

  const reload = async () => {
    if (!machine) return;
    setReloading(true);
    try {
      const latest = await machinesApi.get(machine.id);
      setRowVersion(latest.rowVersion); // entered values stay as they are
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setReloading(false);
    }
  };

  const text = (k: keyof FormState, type = 'text') => (
    <div className="space-y-1" key={k}>
      <label htmlFor={`mf-${k}`} className="text-xs font-medium text-muted-foreground">
        {LABELS[k]}{REQUIRED.includes(k) && <span className="text-rose-500"> *</span>}
      </label>
      <Input id={`mf-${k}`} type={type} value={form[k]} onChange={(e) => set(k, e.target.value)} />
      {touched && REQUIRED.includes(k) && !form[k].trim() && <p className="text-xs text-rose-500">{LABELS[k]} is required</p>}
      {fieldErrors[k] && <p className="text-xs text-rose-500">{fieldErrors[k]}</p>}
    </div>
  );

  const selectClass = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>{isEdit ? 'Edit Machine' : 'Add Machine'}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {error != null && <ApiErrorNotice error={error} onReload={() => void reload()} reloading={reloading} />}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {text('fleetNo')}
            {text('assetNo')}
            {text('serialNo')}
            <div className="space-y-1">
              <label htmlFor="mf-modelId" className="text-xs font-medium text-muted-foreground">Model <span className="text-rose-500">*</span></label>
              <select id="mf-modelId" className={selectClass} value={form.modelId} onChange={(e) => set('modelId', e.target.value)}>
                <option value="">Select a model</option>
                {(models.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.make} {m.model}</option>)}
              </select>
              {touched && !form.modelId && <p className="text-xs text-rose-500">Model is required</p>}
              {fieldErrors.modelId && <p className="text-xs text-rose-500">{fieldErrors.modelId}</p>}
            </div>
            <div className="space-y-1">
              <label htmlFor="mf-branchId" className="text-xs font-medium text-muted-foreground">Branch <span className="text-rose-500">*</span></label>
              <select id="mf-branchId" className={selectClass} value={form.branchId} onChange={(e) => set('branchId', e.target.value)}>
                <option value="">Select a branch</option>
                {(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              {touched && !form.branchId && <p className="text-xs text-rose-500">Branch is required</p>}
              {fieldErrors.branchId && <p className="text-xs text-rose-500">{fieldErrors.branchId}</p>}
            </div>
            {text('currentLocation')}
            <div className="space-y-1">
              <label htmlFor="mf-powerSource" className="text-xs font-medium text-muted-foreground">Power source</label>
              <select id="mf-powerSource" className={selectClass} value={form.powerSource} onChange={(e) => set('powerSource', e.target.value)}>
                <option value="">From model</option>
                {POWER_SOURCES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            {text('manufactureYear', 'number')}
            {text('hoursOperated', 'number')}
            {!isEdit && (
              <div className="space-y-1">
                <label htmlFor="mf-operationalStatus" className="text-xs font-medium text-muted-foreground">Status</label>
                <select id="mf-operationalStatus" className={selectClass} value={form.operationalStatus} onChange={(e) => set('operationalStatus', e.target.value)}>
                  {CREATE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
            {text('tpcExpiresOn', 'date')}
            {text('tpcSupplier')}
            {text('lastInspectionOn', 'date')}
            {text('nextInspectionOn', 'date')}
          </div>
          {isEdit && <p className="text-xs text-muted-foreground">Allocated, On Hire and Transport are set by bookings and transport jobs; use the status action in the machine panel for manual overrides.</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={pending} onClick={() => void submit()}>
            {pending ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Machine'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
