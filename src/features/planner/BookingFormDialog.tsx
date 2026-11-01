import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useMemo } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useCustomers, useMachines, useBranches } from '@/hooks/useQueries';
import { toastSuccess, toastError } from '@/lib/toast-helper';
import { Booking } from '@/types';
import { useBookingStore, computeTotalValue, computeBookingStatus } from '@/store/bookingStore';
import { CheckCircle2, Circle, AlertTriangle } from 'lucide-react';

const bookingSchema = z.object({
  customerId:       z.string().min(1, 'Customer is required'),
  machineId:        z.string().min(1, 'Machine is required'),
  startDate:        z.string().min(1, 'Start date is required'),
  endDate:          z.string().min(1, 'End date is required'),
  period:           z.enum(['Daily', 'Weekly', 'Monthly', '2-Day', '1-Day']),
  time:             z.enum(['AM', 'PM', 'Specific']).default('AM'),
  specificTime:     z.string().optional(),
  dailyRate:        z.coerce.number().positive('Rate must be positive'),
  deliveryAddress:  z.string().min(5, 'Delivery address is required'),
  siteContactName:  z.string().min(2, 'Site contact name required'),
  siteContactPhone: z.string().regex(/^[\d\s\+\-\(\)]+$/, 'Invalid phone number'),
  branchId:         z.string().min(1, 'Branch is required'),
  operatorRequired: z.boolean().default(false),
  // Legal Dispatch Gates
  quoted:           z.boolean().default(false),
  haSent:           z.boolean().default(false),
  haReceived:       z.boolean().default(false),
  lpoNumber:        z.string().optional(),
  lpoValidityDate:  z.string().optional(),
  // Sales & Payment
  salesRep:         z.enum(['BG', 'AD', 'CH', 'AM', 'SM', 'SK', 'TD', 'SH', 'MT']).optional(),
  paymentTerms:     z.enum(['30', '45', '60', '90', 'Cash Advance', 'PDC']).optional(),
  remarks:          z.string().optional(),
  reserved:         z.boolean().default(false),
}).refine(d => !d.endDate || !d.startDate || new Date(d.endDate) >= new Date(d.startDate), {
  message: 'End date must be after start date',
  path: ['endDate'],
});

type BookingFormData = z.infer<typeof bookingSchema>;

interface BookingFormDialogProps {
  open: boolean;
  onClose: () => void;
  booking?: Booking | null;
  defaultBranchId?: string;
}

export function BookingFormDialog({ open, onClose, booking, defaultBranchId }: BookingFormDialogProps) {
  const { data: customers } = useCustomers();
  const { data: machines }  = useMachines();
  const { data: branches }  = useBranches();
  const { addBooking, updateBooking } = useBookingStore();
  const isEditing = !!booking;

  const form = useForm<BookingFormData>({
    resolver: zodResolver(bookingSchema),
    defaultValues: booking ? {
      customerId:       booking.customerId,
      machineId:        booking.machineId,
      startDate:        booking.startDate,
      endDate:          booking.endDate,
      period:           (booking as any).period || 'Monthly',
      time:             (booking as any).time || 'AM',
      dailyRate:        booking.dailyRate,
      deliveryAddress:  booking.deliveryAddress,
      branchId:         booking.branchId,
      operatorRequired: booking.operatorRequired ?? false,
      quoted:           (booking as any).quoted ?? false,
      haSent:           (booking as any).haSent ?? false,
      haReceived:       (booking as any).haReceived ?? false,
      lpoNumber:        (booking as any).lpoNumber ?? '',
      lpoValidityDate:  (booking as any).lpoValidityDate ?? '',
      reserved:         false,
    } : {
      period:           'Monthly',
      time:             'AM',
      dailyRate:        0,
      branchId:         defaultBranchId ?? '',
      operatorRequired: false,
      quoted:           false,
      haSent:           false,
      haReceived:       false,
      reserved:         false,
    },
  });

  // Watch fields for live calculations
  const watchedFields = form.watch();
  const { startDate, endDate, dailyRate, quoted, haSent, haReceived, lpoNumber, lpoValidityDate, reserved, branchId } = watchedFields;

  // Live Total Value
  const totalValue = useMemo(
    () => computeTotalValue(dailyRate, startDate, endDate),
    [dailyRate, startDate, endDate]
  );

  // Gates completion state — 4 conditions
  const gates = {
    quoted:      !!quoted,
    haSent:      !!haSent,
    haReceived:  !!haReceived,
    lpoComplete: !!(lpoNumber && lpoValidityDate),
  };
  const gatesCount    = Object.values(gates).filter(Boolean).length;
  const gatesComplete = gatesCount === 4;

  // Available machines filtered by branch
  const availableMachines = useMemo(
    () => machines?.filter(m => m.status === 'Available' && (!branchId || m.branchId === branchId)) || [],
    [machines, branchId]
  );

  const onSubmit = async (data: BookingFormData, saveAsReserved = false) => {
    try {
      const customer = customers?.find(c => c.id === data.customerId);
      const machine  = machines?.find(m => m.id === data.machineId);
      const branch   = branches?.find(b => b.id === data.branchId);

      const bookingData = {
        ...data,
        quoted:   data.quoted,
        haSent:   data.haSent,
        haReceived: data.haReceived,
        lpoNumber:  data.lpoNumber,
        lpoValidityDate: data.lpoValidityDate,
        reserved: saveAsReserved || data.reserved,
      };

      const status = computeBookingStatus(bookingData);

      const now = new Date().toISOString();
      const newBooking: Booking = {
        id:           `bk-user-${Date.now()}`,
        reference:    `BK-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
        customerId:   data.customerId,
        customerName: customer?.name ?? data.customerId,
        machineId:    data.machineId,
        assetNumber:  machine?.assetNumber ?? data.machineId,
        machineModel: machine ? `${machine.make} ${machine.model}` : '',
        branchId:     data.branchId,
        branchName:   branch?.name ?? data.branchId,
        startDate:    data.startDate,
        endDate:      data.endDate,
        status,
        deliveryAddress:  data.deliveryAddress,
        contactPhone:     data.siteContactPhone,
        operatorRequired: data.operatorRequired,
        dailyRate:    data.dailyRate,
        totalValue,
        notes:        data.remarks ?? '',
        // Extra fields
        ...(bookingData as any),
        createdAt: now,
        updatedAt: now,
      } as any;

      if (isEditing) {
        updateBooking(booking.id, newBooking);
        toastSuccess('Booking updated');
      } else {
        addBooking(newBooking);
        toastSuccess(
          saveAsReserved || !gatesComplete
            ? 'Booking saved as Reserved — complete gates to dispatch'
            : 'Booking created — ready to dispatch'
        );
      }
      form.reset();
      onClose();
    } catch {
      toastError('Failed to save booking');
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

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Booking' : 'Create New Booking'}</DialogTitle>
          <DialogDescription>
            {isEditing ? 'Update booking details' : 'Create a new machine rental booking (REF-08)'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form className="space-y-4">
            {/* Row 1 — Customer + Machine */}
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="customerId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Customer*</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {customers?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="machineId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Machine* <span className="text-xs text-muted-foreground">(Available in branch)</span></FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select machine" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {availableMachines.map(m => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.assetNumber} — {m.make} {m.model} ({(m as any).type ?? ''}·{(m as any).energy ?? ''} {(m as any).wh ?? m.workingHeight}m)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* Row 2 — Dates */}
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="startDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Start Date*</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="endDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>End Date*</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* Row 3 — Period + Time + Rate + Total Value */}
            <div className="grid grid-cols-4 gap-4">
              <FormField control={form.control} name="period" render={({ field }) => (
                <FormItem>
                  <FormLabel>Billing Period*</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {['Daily', 'Weekly', 'Monthly', '2-Day', '1-Day'].map(p => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="time" render={({ field }) => (
                <FormItem>
                  <FormLabel>Time*</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {['AM', 'PM', 'Specific'].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="dailyRate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Daily Rate (AED)*</FormLabel>
                  <FormControl><Input type="number" step="0.01" placeholder="0.00" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              {/* Live Total Value */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Total Value (AED)</label>
                <div className={`flex h-10 items-center rounded-md border px-3 text-sm font-semibold ${
                  totalValue > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300' : 'bg-muted text-muted-foreground'
                }`}>
                  {totalValue > 0 ? `AED ${totalValue.toLocaleString()}` : '—'}
                </div>
                {totalValue > 0 && startDate && endDate && (
                  <p className="text-[10px] text-muted-foreground">
                    {Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1} days × AED {dailyRate}
                  </p>
                )}
              </div>
            </div>

            {form.watch('time') === 'Specific' && (
              <FormField control={form.control} name="specificTime" render={({ field }) => (
                <FormItem>
                  <FormLabel>Specific Time</FormLabel>
                  <FormControl><Input type="time" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            )}

            {/* Row 4 — Branch */}
            <FormField control={form.control} name="branchId" render={({ field }) => (
              <FormItem>
                <FormLabel>Branch*</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {branches?.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {/* Row 5 — Delivery Address */}
            <FormField control={form.control} name="deliveryAddress" render={({ field }) => (
              <FormItem>
                <FormLabel>Delivery Address / Site*</FormLabel>
                <FormControl><Input placeholder="Full site address" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {/* Row 6 — Site Contact */}
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="siteContactName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Site Contact Name*</FormLabel>
                  <FormControl><Input placeholder="Contact person" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="siteContactPhone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Site Contact Phone*</FormLabel>
                  <FormControl><Input placeholder="+971 50 123 4567" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* Operator Required */}
            <FormField control={form.control} name="operatorRequired" render={({ field }) => (
              <FormItem className="flex items-center gap-2 space-y-0">
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
                <FormLabel className="text-sm font-medium cursor-pointer">Operator Required</FormLabel>
              </FormItem>
            )} />

            {/* LEGAL DISPATCH GATES */}
            <Card className={`p-4 border-2 ${gatesComplete ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20' : 'border-amber-200 bg-amber-50 dark:bg-amber-950/20'}`}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className={`text-sm font-semibold ${gatesComplete ? 'text-emerald-900 dark:text-emerald-100' : 'text-amber-900 dark:text-amber-100'}`}>
                    Legal Dispatch Gates (REF-08)
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Delivery job cannot be created unless all 4 are complete
                  </p>
                </div>
                <Badge variant={gatesComplete ? 'default' : 'outline'} className={gatesComplete ? 'bg-emerald-600' : 'text-amber-700 border-amber-300'}>
                  {gatesCount}/4 complete
                </Badge>
              </div>

              {/* 3 Checkboxes */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                <FormField control={form.control} name="quoted" render={({ field }) => (
                  <FormItem className="flex items-center gap-2 space-y-0">
                    <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    <FormLabel className="text-sm font-medium cursor-pointer">QT'd (Quoted)</FormLabel>
                  </FormItem>
                )} />
                <FormField control={form.control} name="haSent" render={({ field }) => (
                  <FormItem className="flex items-center gap-2 space-y-0">
                    <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    <FormLabel className="text-sm font-medium cursor-pointer">HA Sent</FormLabel>
                  </FormItem>
                )} />
                <FormField control={form.control} name="haReceived" render={({ field }) => (
                  <FormItem className="flex items-center gap-2 space-y-0">
                    <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    <FormLabel className="text-sm font-medium cursor-pointer">HA Recd? (Signed)</FormLabel>
                  </FormItem>
                )} />
              </div>

              {/* Live gate checklist */}
              <div className="grid grid-cols-2 gap-2 p-3 rounded-lg bg-white/60 dark:bg-background/40">
                <GateItem done={gates.quoted}      label="QT'd — Quoted" />
                <GateItem done={gates.haSent}      label="HA Sent" />
                <GateItem done={gates.haReceived}  label="HA Received (Signed)" />
                <GateItem done={gates.lpoComplete} label="LPO Number + Validity" />
              </div>

              {!gatesComplete && (
                <div className="flex items-center gap-1.5 mt-3">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Incomplete gates — booking will be saved as <strong>Reserved</strong> (holds slot, no dispatch)
                  </p>
                </div>
              )}
            </Card>

            {/* LPO */}
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="lpoNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel>LPO Number {!gates.lpoComplete && <span className="text-amber-600 text-xs">(required for dispatch)</span>}</FormLabel>
                  <FormControl><Input placeholder="LPO-123456" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="lpoValidityDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>LPO Validity Date</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* Sales + Payment Terms */}
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="salesRep" render={({ field }) => (
                <FormItem>
                  <FormLabel>Sales Rep</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select rep" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {['BG', 'AD', 'CH', 'AM', 'SM', 'SK', 'TD', 'SH', 'MT'].map(r => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="paymentTerms" render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Terms</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select terms" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {['30', '45', '60', '90', 'Cash Advance', 'PDC'].map(t => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* Remarks */}
            <FormField control={form.control} name="remarks" render={({ field }) => (
              <FormItem>
                <FormLabel>Remarks / Notes</FormLabel>
                <FormControl><Textarea placeholder="Special instructions, notes..." rows={2} {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {/* Mark as Reserved */}
            <FormField control={form.control} name="reserved" render={({ field }) => (
              <FormItem className="flex items-center gap-2 space-y-0">
                <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                <FormLabel className="text-sm font-medium cursor-pointer">Mark as Reserved (hold slot without dispatching)</FormLabel>
              </FormItem>
            )} />

            {/* Footer — conditional buttons */}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              {!gatesComplete ? (
                // Gates incomplete — only Save as Reserved
                <Button
                  type="button"
                  variant="secondary"
                  onClick={form.handleSubmit((d) => onSubmit(d, true))}
                >
                  Save as Reserved
                </Button>
              ) : (
                // Gates complete — Create (dispatch-ready)
                <Button
                  type="button"
                  className="bg-orange-500 hover:bg-orange-600 text-white"
                  onClick={form.handleSubmit((d) => onSubmit(d, false))}
                >
                  {isEditing ? 'Update Booking' : 'Create Booking'}
                </Button>
              )}
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
