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
import { useCreateTransportJob, useMachines, useDrivers } from '@/hooks/useQueries';
import { toastSuccess, toastError } from '@/lib/toast-helper';

// REF-13 Transport Schedule — exact 15 fields (4 header + 11 per job)
const transportJobSchema = z.object({
  // ── HEADER — 4 fields (REF-13) ───────────────────────────────
  plannerName:    z.string().min(1, 'Planner name required'),     // Planner Name
  date:           z.string().min(1, 'Date required'),             // Date
  shift:          z.enum(['Morning', 'Evening']),                 // Shift
  transportTeam:  z.string().min(1, 'Transport team required'),   // Transport Team (e.g. MT 4 - RACHHPAL)

  // ── TRANSPORT RECORD — 11 fields (REF-13) ────────────────────
  srNo:      z.coerce.number().min(1),                            // Sr. No
  fleet:     z.string().min(1, 'Fleet number required'),          // Fleet (fleet number(s))
  from:      z.string().min(1, 'Pickup location required'),       // From
  to:        z.string().min(1, 'Delivery destination required'),  // To
  transport: z.string().min(1, 'Transport vehicle required'),     // Transport (MT 4 [S], MT 4 [R])
  type:      z.enum(['D', 'T', 'O', 'T2']),                      // Type (D/T/O/T2)
  contact:   z.string().min(1, 'Contact required'),               // Contact (driver/site contact + phone)
  sales:     z.enum(['BG', 'AD', 'CH', 'AM', 'SM', 'SK', 'TD', 'SH', 'MT', 'TS']), // Sales (rep code)
  client:    z.string().min(1, 'Client required'),                // Client
  time:      z.string().min(1, 'Time required'),                  // Time
  remarks:   z.string().optional(),                               // Remarks (TBC, Transfer, special)
});

type TransportJobFormData = z.infer<typeof transportJobSchema>;

interface TransportJobDialogProps {
  open: boolean;
  onClose: () => void;
}

// REF-13: Transport teams/vehicles
const transportTeams = [
  'MT 1', 'MT 2', 'MT 3', 'MT 4', 'MT 5',
  'MT 4 [S]', 'MT 4 [R]',
  'AUH Truck #1', 'AUH Truck #2',
  'DXB Truck #1', 'DXB Truck #2', 'DXB Truck #3',
  'External',
];

export function TransportJobDialog({ open, onClose }: TransportJobDialogProps) {
  const { data: machines } = useMachines();
  const createMutation = useCreateTransportJob();

  const form = useForm<TransportJobFormData>({
    resolver: zodResolver(transportJobSchema),
    defaultValues: {
      date:  new Date().toISOString().split('T')[0],
      shift: 'Morning',
      type:  'D',
      srNo:  1,
    },
  });

  const onSubmit = async (data: TransportJobFormData) => {
    try {
      await createMutation.mutateAsync(data);
      toastSuccess('Transport job created successfully');
      form.reset();
      onClose();
    } catch {
      toastError('Failed to create transport job');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Transport Schedule (REF-13)</DialogTitle>
          <DialogDescription>
            4 header fields + 11 job fields — Planner · Date · Shift · Transport Team · Fleet · From · To · Transport · Type · Contact · Sales · Client · Time · Remarks
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">

            {/* ── HEADER — 4 fields (REF-13) ── */}
            <Card className="p-4 bg-muted/30">
              <h3 className="text-sm font-semibold mb-3">Schedule Header</h3>
              <div className="grid grid-cols-2 gap-4">
                {/* Planner Name */}
                <FormField control={form.control} name="plannerName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Planner Name*</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Prashanth" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Date */}
                <FormField control={form.control} name="date" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date*</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Shift */}
                <FormField control={form.control} name="shift" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Shift*</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="Morning">Morning</SelectItem>
                        <SelectItem value="Evening">Evening</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Transport Team */}
                <FormField control={form.control} name="transportTeam" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Transport Team*</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. MT 4 - RACHHPAL" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </Card>

            {/* ── TRANSPORT RECORD — 11 fields (REF-13) ── */}
            <Card className="p-4 bg-sky-50 dark:bg-sky-950/20 border-sky-200">
              <h3 className="text-sm font-semibold text-sky-900 dark:text-sky-100 mb-3">Transport Job</h3>
              <div className="grid grid-cols-3 gap-4">

                {/* Sr. No */}
                <FormField control={form.control} name="srNo" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sr. No*</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} placeholder="1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Fleet */}
                <FormField control={form.control} name="fleet" render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Fleet (Fleet No.)*</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select fleet number" /></SelectTrigger>
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

                {/* From */}
                <FormField control={form.control} name="from" render={({ field }) => (
                  <FormItem>
                    <FormLabel>From*</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. AUH Yard" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* To */}
                <FormField control={form.control} name="to" render={({ field }) => (
                  <FormItem>
                    <FormLabel>To*</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. JiuJitsu Arena" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Transport vehicle */}
                <FormField control={form.control} name="transport" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Transport*</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="e.g. MT 4 [S]" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {transportTeams.map(t => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Type D/T/O/T2 */}
                <FormField control={form.control} name="type" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type*</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="D">D — Delivery</SelectItem>
                        <SelectItem value="T">T — Transfer</SelectItem>
                        <SelectItem value="O">O — Other</SelectItem>
                        <SelectItem value="T2">T2 — Transfer 2</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Contact */}
                <FormField control={form.control} name="contact" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact*</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Mohammed / +971 50 123" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Sales rep */}
                <FormField control={form.control} name="sales" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sales*</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Rep code" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {['BG', 'AD', 'CH', 'AM', 'SM', 'SK', 'TD', 'SH', 'MT', 'TS'].map(r => (
                          <SelectItem key={r} value={r}>{r}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Client */}
                <FormField control={form.control} name="client" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Client*</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Katch Events" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Time */}
                <FormField control={form.control} name="time" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Time*</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* Remarks */}
              <FormField control={form.control} name="remarks" render={({ field }) => (
                <FormItem className="mt-4">
                  <FormLabel>Remarks</FormLabel>
                  <FormControl>
                    <Textarea placeholder="e.g. TBC, Transfer, special instructions..." rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </Card>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create Transport Job'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
