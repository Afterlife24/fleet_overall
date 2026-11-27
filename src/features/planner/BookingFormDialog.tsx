import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { describeApiError } from '@/components/common/ApiStatus';
import { useApiBranches, useFleetMachines, useLpos } from '@/hooks/useApiResources';
import {
  fetchBooking, useCreateBooking, usePlannerAgreements, usePlannerCustomers, useSubmission, useUpdateBooking,
} from '@/hooks/api/usePlannerApi';
import { toastSuccess } from '@/lib/toast-helper';
import { Booking } from '@/types';
import { computeTotalValue } from '@/store/bookingStore';
import { CheckCircle2, Circle, AlertTriangle } from 'lucide-react';
import { BookingErrorNotice } from './BookingErrorNotice';
import { buildBookingCreate, buildBookingUpdate, planningStatus } from './bookingRecord';

const bookingSchema = z.object({
  customerId:       z.string().min(1, 'Customer is required'),
  machineId:        z.string().min(1, 'Machine is required'),
  branchId:         z.string().optional(),
  startDate:        z.string().min(1, 'Start date is required'),
  endDate:          z.string().min(1, 'End date is required'),
  dailyRate:        z.coerce.number().positive('Rate must be positive'),
  deliveryAddress:  z.string().min(5, 'Delivery address is required'),
  siteContactPhone: z.string().regex(/^[\d\s+\-()]+$/, 'Invalid phone number'),
  operatorRequired: z.boolean().default(false),
  quoted:           z.boolean().default(false),
  hireAgreementId:  z.string().optional(),
  lpoId:            z.string().optional(),
  remarks:          z.string().optional(),
  reserved:         z.boolean().default(false),
}).refine(d => !d.endDate || !d.startDate || new Date(d.endDate) >= new Date(d.startDate), {
  message: 'End date must be on or after the start date',
  path: ['endDate'],
});

type BookingFormData = z.infer<typeof bookingSchema>;

interface BookingFormDialogProps {
  open: boolean;
  onClose: () => void;
  booking?: Booking | null;
  defaultBranchId?: string;
}

const UNBOOKABLE = new Set(['Offline', 'Under Repair', 'Breakdown']);
const selectClass = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm';

function defaults(booking: Booking | null | undefined, defaultBranchId?: string): BookingFormData {
  return booking
    ? {
        customerId: booking.customerId, machineId: booking.machineId, branchId: booking.branchId,
        startDate: booking.startDate, endDate: booking.endDate, dailyRate: booking.dailyRate,
        deliveryAddress: booking.deliveryAddress, siteContactPhone: booking.contactPhone,
        operatorRequired: booking.operatorRequired ?? false, quoted: booking.quoted ?? false,
        hireAgreementId: booking.hireAgreementId ?? '', lpoId: booking.lpoId ?? '',
        remarks: booking.notes ?? '', reserved: booking.reserved ?? false,
      }
    : {
        customerId: '', machineId: '', branchId: defaultBranchId ?? '', startDate: '', endDate: '', dailyRate: 0,
        deliveryAddress: '', siteContactPhone: '', operatorRequired: false, quoted: false, hireAgreementId: '',
        lpoId: '', remarks: '', reserved: false,
      };
}

/** Create or edit a booking through `/api/v1/bookings`. Edits send the row version; entered values survive an error. */
export function BookingFormDialog({ open, onClose, booking, defaultBranchId }: BookingFormDialogProps) {
  const customers = usePlannerCustomers();
  const machines = useFleetMachines();
  const branches = useApiBranches();
  const agreements = usePlannerAgreements();
  const lpos = useLpos();
  const create = useCreateBooking();
  const update = useUpdateBooking();
  const submission = useSubmission();

  // The loaded booking the edit is compared with; "Reload latest" replaces it without touching entered values.
  const [baseline, setBaseline] = useState<Booking | null>(booking ?? null);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const isEditing = !!booking;
  const onHire = baseline?.status === 'On Hire';

  const form = useForm<BookingFormData>({
    resolver: zodResolver(bookingSchema),
    defaultValues: defaults(booking, defaultBranchId),
  });

  useEffect(() => {
    if (!open) return;
    setBaseline(booking ?? null);
    setError(null);
    form.reset(defaults(booking, defaultBranchId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, booking?.id]);

  const values = form.watch();
  const { startDate, endDate, dailyRate, customerId, branchId } = values;

  const customerAgreements = useMemo(
    () => (agreements.data ?? []).filter((a) => a.customerId === customerId && a.status !== 'Cancelled'),
    [agreements.data, customerId],
  );
  const customerLpos = useMemo(() => (lpos.data ?? []).filter((l) => l.customerId === customerId), [lpos.data, customerId]);
  const agreement = customerAgreements.find((a) => a.id === values.hireAgreementId);
  const lpo = customerLpos.find((l) => l.id === values.lpoId);

  const totalValue = useMemo(() => computeTotalValue(Number(dailyRate), startDate, endDate), [dailyRate, startDate, endDate]);

  const availableMachines = useMemo(
    () => (machines.data ?? []).filter((m) =>
      m.id === values.machineId || (!UNBOOKABLE.has(String(m.status)) && (!branchId || m.branchId === branchId))),
    [machines.data, branchId, values.machineId],
  );

  // HA gates come from the saved agreement (sent / received dates); the LPO gate from the chosen LPO.
  const haSent = !!agreement?.sentAt;
  const haReceived = !!agreement?.receivedAt;
  const gates = { quoted: !!values.quoted, haSent, haReceived, lpoComplete: !!lpo };
  const gatesCount = Object.values(gates).filter(Boolean).length;
  const gatesComplete = gatesCount === 4;
  const fieldErrors = error ? describeApiError(error).fieldErrors : {};

  const submit = async (data: BookingFormData, hold: boolean) => {
    setError(null);
    setSaving(true);
    try {
      const gateValues = { ...data, haSent, haReceived, reserved: hold || data.reserved };
      const status = planningStatus({ ...gateValues, lpoId: data.lpoId });
      if (baseline) {
        const patch = buildBookingUpdate(gateValues, status, baseline);
        if (Object.keys(patch).length === 0) { onClose(); return; }
        await update.mutateAsync({ id: baseline.id, rowVersion: baseline.rowVersion ?? 0, patch });
        toastSuccess('Booking updated');
      } else {
        await create.mutateAsync({ body: buildBookingCreate(gateValues, status), submissionId: submission.id() });
        submission.renew();
        toastSuccess(status === 'Reserved' ? 'Booking saved as Reserved. Complete the gates to dispatch.' : 'Booking created, ready to dispatch');
      }
      onClose();
    } catch (err) {
      setError(err); // every entered value stays in the form
    } finally {
      setSaving(false);
    }
  };

  const reload = async () => {
    if (!baseline) return;
    setReloading(true);
    try {
      setBaseline(await fetchBooking(baseline.id)); // entered values are not touched
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setReloading(false);
    }
  };

  const GateItem = ({ done, label }: { done: boolean; label: string }) => (
    <div className="flex items-center gap-2">
      {done
        ? <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
        : <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
      <span className={`text-xs ${done ? 'text-emerald-700 font-medium' : 'text-muted-foreground'}`}>{label}</span>
    </div>
  );

  const err = form.formState.errors;
  const fieldMsg = (name: string, local?: string) => {
    const m = local ?? fieldErrors[name];
    return m ? <p className="text-xs text-rose-500">{m}</p> : null;
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? `Edit Booking ${booking?.reference ?? ''}` : 'Create New Booking'}</DialogTitle>
          <DialogDescription>
            {isEditing ? 'Update booking details' : 'Create a new machine rental booking (REF-08)'}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          {error != null && <BookingErrorNotice error={error} onReload={() => void reload()} reloading={reloading} />}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label htmlFor="bk-customer" className="text-sm font-medium">Customer*</label>
              <select id="bk-customer" className={selectClass} disabled={isEditing} {...form.register('customerId', {
                onChange: () => { form.setValue('hireAgreementId', ''); form.setValue('lpoId', ''); },
              })}>
                <option value="">Select customer</option>
                {customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {fieldMsg('customerId', err.customerId?.message)}
            </div>
            <div className="space-y-1">
              <label htmlFor="bk-machine" className="text-sm font-medium">Machine*</label>
              <select id="bk-machine" className={selectClass} disabled={onHire} {...form.register('machineId')}>
                <option value="">Select machine</option>
                {availableMachines.map((m) => (
                  <option key={m.id} value={m.id}>{m.assetNumber} — {m.make} {m.model}</option>
                ))}
              </select>
              {fieldMsg('machineId', err.machineId?.message)}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <label htmlFor="bk-branch" className="text-sm font-medium">Branch filter</label>
              <select id="bk-branch" className={selectClass} {...form.register('branchId')}>
                <option value="">All branches</option>
                {branches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="bk-start" className="text-sm font-medium">Start Date*</label>
              <Input id="bk-start" type="date" {...form.register('startDate')} />
              {fieldMsg('startDate', err.startDate?.message)}
            </div>
            <div className="space-y-1">
              <label htmlFor="bk-end" className="text-sm font-medium">End Date*</label>
              <Input id="bk-end" type="date" {...form.register('endDate')} />
              {fieldMsg('endDate', err.endDate?.message)}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label htmlFor="bk-rate" className="text-sm font-medium">Daily Rate (AED)*</label>
              <Input id="bk-rate" type="number" step="0.01" placeholder="0.00" {...form.register('dailyRate')} />
              {fieldMsg('dailyRate', err.dailyRate?.message)}
            </div>
            <div className="space-y-1">
              <span className="text-sm font-medium">Total Value (AED)</span>
              <div className={`flex h-9 items-center rounded-md border px-3 text-sm font-semibold ${
                totalValue > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'bg-muted text-muted-foreground'
              }`}>
                {totalValue > 0 ? `AED ${totalValue.toLocaleString()}` : '—'}
              </div>
              <p className="text-[10px] text-muted-foreground">The server computes the stored total.</p>
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="bk-address" className="text-sm font-medium">Delivery Address / Site*</label>
            <Input id="bk-address" placeholder="Full site address" {...form.register('deliveryAddress')} />
            {fieldMsg('deliveryAddress', err.deliveryAddress?.message)}
          </div>

          <div className="space-y-1">
            <label htmlFor="bk-phone" className="text-sm font-medium">Site Contact Phone*</label>
            <Input id="bk-phone" placeholder="+971 50 123 4567" {...form.register('siteContactPhone')} />
            {fieldMsg('contactPhone', err.siteContactPhone?.message)}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label htmlFor="bk-agreement" className="text-sm font-medium">Hire Agreement</label>
              <select id="bk-agreement" className={selectClass} {...form.register('hireAgreementId')}>
                <option value="">None</option>
                {customerAgreements.map((a) => <option key={a.id} value={a.id}>{a.agreementNo}</option>)}
              </select>
              {fieldMsg('hireAgreementId')}
            </div>
            <div className="space-y-1">
              <label htmlFor="bk-lpo" className="text-sm font-medium">LPO Number</label>
              <select id="bk-lpo" className={selectClass} {...form.register('lpoId')}>
                <option value="">None</option>
                {customerLpos.map((l) => (
                  <option key={l.id} value={l.id}>{l.lpoNo}{l.validUntil ? ` (valid until ${l.validUntil})` : ''}</option>
                ))}
              </select>
              {lpo && <p className="text-xs text-muted-foreground">Validity: {lpo.validUntil ?? 'no end date'}</p>}
              {fieldMsg('lpoId')}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <Checkbox checked={!!values.operatorRequired} onCheckedChange={(c) => form.setValue('operatorRequired', c === true)} />
            Operator Required
          </label>

          {/* Dispatch gates */}
          <Card className={`p-4 border-2 ${gatesComplete ? 'border-emerald-300 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className={`text-sm font-semibold ${gatesComplete ? 'text-emerald-900' : 'text-amber-900'}`}>Legal Dispatch Gates (REF-08)</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Delivery job cannot be created unless all 4 are complete</p>
              </div>
              <Badge variant={gatesComplete ? 'default' : 'outline'} className={gatesComplete ? 'bg-emerald-600' : 'text-amber-700 border-amber-300'}>
                {gatesCount}/4 complete
              </Badge>
            </div>
            <label className="mb-3 flex items-center gap-2 text-sm font-medium cursor-pointer">
              <Checkbox checked={!!values.quoted} onCheckedChange={(c) => form.setValue('quoted', c === true)} />
              QT'd (Quoted)
            </label>
            {fieldMsg('quoted')}
            <div className="grid grid-cols-2 gap-2 p-3 rounded-lg bg-white/60">
              <GateItem done={gates.quoted} label="QT'd — Quoted" />
              <GateItem done={gates.haSent} label="HA Sent (from the agreement)" />
              <GateItem done={gates.haReceived} label="HA Received (from the agreement)" />
              <GateItem done={gates.lpoComplete} label="LPO linked" />
            </div>
            {(fieldErrors.haSent || fieldErrors.haReceived) && (
              <p className="mt-2 text-xs text-rose-500">{fieldErrors.haSent ?? fieldErrors.haReceived}</p>
            )}
            {!gatesComplete && (
              <div className="flex items-center gap-1.5 mt-3">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                <p className="text-xs text-amber-700">
                  Incomplete gates: the booking is saved as <strong>Reserved</strong> (holds the slot, no dispatch)
                </p>
              </div>
            )}
          </Card>

          <div className="space-y-1">
            <label htmlFor="bk-remarks" className="text-sm font-medium">Remarks / Notes</label>
            <Textarea id="bk-remarks" placeholder="Special instructions, notes..." rows={2} {...form.register('remarks')} />
          </div>

          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <Checkbox checked={!!values.reserved} onCheckedChange={(c) => form.setValue('reserved', c === true)} />
            Mark as Reserved (hold slot without dispatching)
          </label>
          {fieldMsg('reserved')}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            {!gatesComplete && !onHire ? (
              <Button type="button" variant="secondary" disabled={saving} onClick={form.handleSubmit((d) => submit(d, true))}>
                {saving ? 'Saving...' : 'Save as Reserved'}
              </Button>
            ) : (
              <Button type="button" className="bg-orange-500 hover:bg-orange-600 text-white" disabled={saving}
                onClick={form.handleSubmit((d) => submit(d, false))}>
                {saving ? 'Saving...' : isEditing ? 'Update Booking' : 'Create Booking'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
