import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCreateCrossHire, useBranches } from '@/hooks/useQueries';
import { toastSuccess, toastError } from '@/lib/toast-helper';
import { formatCurrency } from '@/utils/format';

const schema = z.object({
  // Machine
  category: z.string().min(1, 'Category is required'),
  make: z.string().min(1, 'Make is required'),
  model: z.string().min(1, 'Model is required'),
  description: z.string().min(1, 'Description is required'),
  quantity: z.coerce.number().int().positive('Qty must be at least 1'),
  // Supplier leg (rent IN)
  supplierName: z.string().min(1, 'Supplier is required'),
  supplierContact: z.string().optional(),
  supplierPhone: z.string().optional(),
  buyRate: z.coerce.number().min(0, 'Buy rate required'),
  supplierPO: z.string().optional(),
  // Client leg (rent OUT)
  customerName: z.string().min(1, 'Client is required'),
  customerContact: z.string().optional(),
  siteLocation: z.string().min(1, 'Site is required'),
  sellRate: z.coerce.number().min(0, 'Sell rate required'),
  clientLPO: z.string().optional(),
  // Commercial
  ratePeriod: z.enum(['Day', 'Week', 'Month']),
  branchId: z.string().min(1, 'Branch is required'),
  status: z.enum(['Enquiry', 'Confirmed', 'On Hire', 'Off Hire', 'Returned', 'Cancelled']),
  startDate: z.string().min(1, 'Start date required'),
  endDate: z.string().min(1, 'End date required'),
  salesRep: z.string().min(1, 'Sales rep required'),
  notes: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

const CATEGORIES = ['Articulating Boom', 'Telescopic Boom', 'Scissor Lift', 'Telehandler', 'Vertical Mast', 'Trailer Mounted', 'Other'];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CrossHireFormDialog({ open, onClose }: Props) {
  const { data: branches } = useBranches();
  const createMutation = useCreateCrossHire();

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      category: 'Articulating Boom',
      quantity: 1,
      ratePeriod: 'Month',
      status: 'Enquiry',
      buyRate: 0,
      sellRate: 0,
    },
  });

  const buyRate = form.watch('buyRate');
  const sellRate = form.watch('sellRate');
  const qty = form.watch('quantity') || 1;
  const period = form.watch('ratePeriod');
  const margin = (Number(sellRate) || 0) - (Number(buyRate) || 0);
  const marginPct = Number(sellRate) > 0 ? Math.round((margin / Number(sellRate)) * 100) : 0;

  const onSubmit = async (data: FormData) => {
    try {
      const branchName = branches?.find((b) => b.id === data.branchId)?.name ?? '';
      await createMutation.mutateAsync({ ...data, branchName } as any);
      toastSuccess('Cross hire created');
      form.reset();
      onClose();
    } catch {
      toastError('Failed to create cross hire');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Cross Hire</DialogTitle>
          <DialogDescription>
            Rent a machine IN from a supplier and OUT to a client at a higher rate.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

            {/* Machine */}
            <Card className="p-4 bg-muted/30">
              <h3 className="text-sm font-semibold mb-3">Equipment</h3>
              <div className="grid grid-cols-3 gap-4">
                <FormField control={form.control} name="category" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category*</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="make" render={({ field }) => (
                  <FormItem><FormLabel>Make*</FormLabel><FormControl><Input placeholder="JLG" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="model" render={({ field }) => (
                  <FormItem><FormLabel>Model*</FormLabel><FormControl><Input placeholder="450AJ" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem className="col-span-2"><FormLabel>Description*</FormLabel><FormControl><Input placeholder="16m Diesel Articulating Boom" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="quantity" render={({ field }) => (
                  <FormItem><FormLabel>Quantity*</FormLabel><FormControl><Input type="number" min={1} {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
            </Card>

            {/* Supplier leg */}
            <Card className="p-4 bg-sky-50 dark:bg-sky-950/20 border-sky-200">
              <h3 className="text-sm font-semibold text-sky-900 dark:text-sky-100 mb-3">Rent IN — Supplier</h3>
              <div className="grid grid-cols-3 gap-4">
                <FormField control={form.control} name="supplierName" render={({ field }) => (
                  <FormItem className="col-span-2"><FormLabel>Supplier*</FormLabel><FormControl><Input placeholder="Rental Solutions LLC" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="supplierPO" render={({ field }) => (
                  <FormItem><FormLabel>Supplier PO</FormLabel><FormControl><Input placeholder="PO-SUP-0001" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="supplierContact" render={({ field }) => (
                  <FormItem><FormLabel>Contact</FormLabel><FormControl><Input placeholder="Contact person" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="supplierPhone" render={({ field }) => (
                  <FormItem><FormLabel>Phone</FormLabel><FormControl><Input placeholder="+971 ..." {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="buyRate" render={({ field }) => (
                  <FormItem><FormLabel>Buy Rate (AED)*</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
            </Card>

            {/* Client leg */}
            <Card className="p-4 bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200">
              <h3 className="text-sm font-semibold text-emerald-900 dark:text-emerald-100 mb-3">Rent OUT — Client</h3>
              <div className="grid grid-cols-3 gap-4">
                <FormField control={form.control} name="customerName" render={({ field }) => (
                  <FormItem className="col-span-2"><FormLabel>Client*</FormLabel><FormControl><Input placeholder="Al Futtaim Construction" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="clientLPO" render={({ field }) => (
                  <FormItem><FormLabel>Client LPO</FormLabel><FormControl><Input placeholder="LPO-0001" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="customerContact" render={({ field }) => (
                  <FormItem><FormLabel>Contact</FormLabel><FormControl><Input placeholder="Contact person" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="siteLocation" render={({ field }) => (
                  <FormItem className="col-span-2"><FormLabel>Site Location*</FormLabel><FormControl><Input placeholder="Dubai Hills, Dubai" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="sellRate" render={({ field }) => (
                  <FormItem><FormLabel>Sell Rate (AED)*</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>

              {/* Live margin preview */}
              <div className="mt-4 flex flex-wrap items-center gap-4 rounded-lg border border-emerald-300/60 bg-background/60 px-4 py-3 text-sm">
                <span className="text-muted-foreground">Margin / {period.toLowerCase()} / unit:</span>
                <span className={margin >= 0 ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-semibold text-rose-600 dark:text-rose-400'}>
                  {formatCurrency(margin)} ({marginPct}%)
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">Total ({qty} unit{qty > 1 ? 's' : ''}):</span>
                <span className={margin >= 0 ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-semibold text-rose-600 dark:text-rose-400'}>
                  {formatCurrency(margin * qty)}
                </span>
              </div>
            </Card>

            {/* Commercial / scheduling */}
            <Card className="p-4 bg-muted/30">
              <h3 className="text-sm font-semibold mb-3">Deal & Schedule</h3>
              <div className="grid grid-cols-3 gap-4">
                <FormField control={form.control} name="ratePeriod" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rate Period*</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="Day">Day</SelectItem>
                        <SelectItem value="Week">Week</SelectItem>
                        <SelectItem value="Month">Month</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="branchId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Branch*</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger></FormControl>
                      <SelectContent>{branches?.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status*</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {['Enquiry', 'Confirmed', 'On Hire', 'Off Hire', 'Returned', 'Cancelled'].map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="startDate" render={({ field }) => (
                  <FormItem><FormLabel>Start Date*</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="endDate" render={({ field }) => (
                  <FormItem><FormLabel>End Date*</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="salesRep" render={({ field }) => (
                  <FormItem><FormLabel>Sales Rep*</FormLabel><FormControl><Input placeholder="Rep name" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem className="mt-4"><FormLabel>Notes</FormLabel><FormControl><Textarea rows={2} placeholder="Why cross-hired, special terms..." {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </Card>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Saving...' : 'Create Cross Hire'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
