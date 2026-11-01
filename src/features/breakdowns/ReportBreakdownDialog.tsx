import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useCreateBreakdown, useMachines, useTechnicians } from '@/hooks/useQueries';
import { toastSuccess, toastError } from '@/lib/toast-helper';
import { useAppStore } from '@/store/appStore';
import { useEffect } from 'react';

// REF-18 On-Site Breakdown Record — exact 10 fields
// + §9.2 additions: site contact name/phone, fault attribution
const breakdownSchema = z.object({
  // ── REF-18 BREAKDOWN INFORMATION (5 fields) ──────────────────
  client:           z.string().min(1, 'Client is required'),          // Client
  eqptNo:           z.string().min(1, 'Equipment number is required'), // EqptNo
  breakdownDetails: z.string().min(5, 'Breakdown details required'),  // BreakdownDetails
  bdReportedDate:   z.string().min(1, 'Reported date required'),      // BD_ReportedDate
  bdReportedTime:   z.string().min(1, 'Reported time required'),      // BD_ReportedTime

  // ── REF-18 SERVICE INFORMATION (3 fields) ────────────────────
  engineer:               z.string().optional(),                      // Engineer
  completionDate:         z.string().optional(),                      // CompletionDate
  engineerCompletionTime: z.string().optional(),                      // Engineer_CompletionTime

  // ── REF-18 TECHNICAL DETAILS (2 fields) ──────────────────────
  machineNotes:   z.string().optional(),                              // MachineNotes
  actualWorkDone: z.string().optional(),                              // ActualWorkDone

  // ── §9.2 ADDITIONAL OPERATIONAL FIELDS ───────────────────────
  // (Required per overview.md §9.2 — not on REF-18 but part of workflow)
  siteContactName:  z.string().optional(),
  siteContactPhone: z.string().optional(),
  severity:         z.enum(['Critical', 'High', 'Medium', 'Low']),

  // ── §9.3 FAULT ATTRIBUTION ────────────────────────────────────
  faultAttribution: z.enum([
    'JA Fault',
    'Customer-caused damage',
    'Operator error',
    'No fault found',
    'Warranty/OEM',
    'No access - client issue',
  ]).optional(),
});

type BreakdownFormData = z.infer<typeof breakdownSchema>;

interface ReportBreakdownDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ReportBreakdownDialog({ open, onClose }: ReportBreakdownDialogProps) {
  const { data: machines } = useMachines();
  const { data: technicians } = useTechnicians();
  const createMutation = useCreateBreakdown();
  const { getActiveBookingForMachine, addBreakdown } = useAppStore();

  const form = useForm<BreakdownFormData>({
    resolver: zodResolver(breakdownSchema),
    defaultValues: {
      severity:       'Medium',
      bdReportedDate: new Date().toISOString().split('T')[0],
      bdReportedTime: new Date().toTimeString().slice(0, 5),
    },
  });

  // Watch eqptNo (machineId) to auto-fill client from active booking
  const watchedMachineId = form.watch('eqptNo');
  useEffect(() => {
    if (watchedMachineId) {
      const machine = machines?.find(m => m.id === watchedMachineId);
      const activeBooking = getActiveBookingForMachine(watchedMachineId);
      if (activeBooking) {
        form.setValue('client', activeBooking.customerName);
        form.setValue('siteContactName', (activeBooking as any).siteContactName || '');
        form.setValue('siteContactPhone', activeBooking.contactPhone || '');
      }
    }
  }, [watchedMachineId, machines, form, getActiveBookingForMachine]);

  const onSubmit = async (data: BreakdownFormData) => {
    try {
      const machine = machines?.find(m => m.id === data.eqptNo);
      const activeBooking = getActiveBookingForMachine(data.eqptNo);

      // Save breakdown with auto-linked booking
      const breakdownData = {
        ...data,
        machineId: data.eqptNo,
        bookingId: activeBooking?.id,
        bookingReference: activeBooking?.reference,
        customerName: activeBooking?.customerName || data.client,
        status: 'Open' as const,
      };

      const now = new Date().toISOString();
      addBreakdown({
        ...breakdownData,
        id: `bd-${Date.now()}`,
        reference: `BD-${String(Date.now()).slice(-4)}`,
        createdAt: now,
        updatedAt: now,
      } as any);

      await createMutation.mutateAsync(breakdownData);

      toastSuccess(
        activeBooking
          ? `Breakdown reported — linked to booking ${activeBooking.reference}`
          : 'Breakdown reported successfully'
      );
      form.reset();
      onClose();
    } catch (err) {
      console.error('Breakdown report error:', err);
      toastError('Failed to report breakdown');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>On-Site Breakdown Record (REF-18)</DialogTitle>
          <DialogDescription>
            10 fields: Client · EqptNo · BreakdownDetails · BD_ReportedDate · BD_ReportedTime ·
            Engineer · CompletionDate · Engineer_CompletionTime · MachineNotes · ActualWorkDone
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

            {/* ── BREAKDOWN INFORMATION (REF-18 — 5 fields) ── */}
            <Card className="p-4 bg-muted/30">
              <h3 className="text-sm font-semibold mb-3">Breakdown Information</h3>

              <div className="grid grid-cols-2 gap-4">
                {/* Client (REF-18) */}
                <FormField control={form.control} name="client" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Client*</FormLabel>
                    <FormControl>
                      <Input placeholder="Customer name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* EqptNo (REF-18) */}
                <FormField control={form.control} name="eqptNo" render={({ field }) => (
                  <FormItem>
                    <FormLabel>EqptNo (Equipment No.)*</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select machine" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {machines?.map(m => (
                          <SelectItem key={m.id} value={m.assetNumber}>
                            {m.assetNumber} — {m.make} {m.model}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* BreakdownDetails (REF-18) */}
              <FormField control={form.control} name="breakdownDetails" render={({ field }) => (
                <FormItem className="mt-4">
                  <FormLabel>BreakdownDetails*</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="e.g. Charging Issues, Drive issues after elevation, Battery not charging..."
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {/* BD_ReportedDate + BD_ReportedTime — SEPARATE fields (REF-18) */}
              <div className="grid grid-cols-2 gap-4 mt-4">
                <FormField control={form.control} name="bdReportedDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>BD_ReportedDate*</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="bdReportedTime" render={({ field }) => (
                  <FormItem>
                    <FormLabel>BD_ReportedTime*</FormLabel>
                    <FormControl><Input type="time" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </Card>

            {/* ── SERVICE INFORMATION (REF-18 — 3 fields) ── */}
            <Card className="p-4 bg-sky-50 dark:bg-sky-950/20 border-sky-200">
              <h3 className="text-sm font-semibold text-sky-900 dark:text-sky-100 mb-3">Service Information</h3>

              {/* Engineer (REF-18) */}
              <FormField control={form.control} name="engineer" render={({ field }) => (
                <FormItem className="mb-4">
                  <FormLabel>Engineer</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Assign engineer" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {technicians?.map(t => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              {/* CompletionDate + Engineer_CompletionTime — SEPARATE fields (REF-18) */}
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="completionDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>CompletionDate</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="engineerCompletionTime" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Engineer_CompletionTime</FormLabel>
                    <FormControl><Input type="time" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </Card>

            {/* ── TECHNICAL DETAILS (REF-18 — 2 fields) ── */}
            <Card className="p-4 bg-muted/30">
              <h3 className="text-sm font-semibold mb-3">Technical Details</h3>

              {/* MachineNotes (REF-18) */}
              <FormField control={form.control} name="machineNotes" render={({ field }) => (
                <FormItem>
                  <FormLabel>MachineNotes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="e.g. Charger, Wiring Issues, Limit Switch Issues, No Fault Found..."
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {/* ActualWorkDone (REF-18) */}
              <FormField control={form.control} name="actualWorkDone" render={({ field }) => (
                <FormItem className="mt-4">
                  <FormLabel>ActualWorkDone</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="e.g. Replaced battery charger and verified all machine functions..."
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </Card>

            <Separator />

            {/* ── §9.2 / §9.3 OPERATIONAL ADDITIONS ── */}
            <Card className="p-4 bg-amber-50 dark:bg-amber-950/20 border-amber-200">
              <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-3">
                Operational Fields (§9.2 / §9.3)
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="siteContactName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Site Contact Name</FormLabel>
                    <FormControl><Input placeholder="Contact at site" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="siteContactPhone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Site Contact Phone</FormLabel>
                    <FormControl><Input placeholder="+971 50 123 4567" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="severity" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Severity</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="Critical">🔴 Critical</SelectItem>
                        <SelectItem value="High">🟠 High</SelectItem>
                        <SelectItem value="Medium">🟡 Medium</SelectItem>
                        <SelectItem value="Low">🟢 Low</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="faultAttribution" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fault Attribution (§9.3)</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="JA Fault">JA Fault (credit client)</SelectItem>
                        <SelectItem value="Customer-caused damage">Customer-caused damage (charge)</SelectItem>
                        <SelectItem value="Operator error">Operator error (charge)</SelectItem>
                        <SelectItem value="No fault found">No fault found</SelectItem>
                        <SelectItem value="Warranty/OEM">Warranty / OEM</SelectItem>
                        <SelectItem value="No access - client issue">No access — client issue (excluded)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </Card>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Reporting...' : 'Submit Breakdown Record'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
