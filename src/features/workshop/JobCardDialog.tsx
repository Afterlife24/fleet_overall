import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { useMachines, useTechnicians, useBranches, useCreateJobCard } from '@/hooks/useQueries';
import { toastSuccess, toastError } from '@/lib/toast-helper';
import { useAppStore } from '@/store/appStore';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

// REF-02 Job Card — exact fields from document
const repairRowSchema = z.object({
  no: z.number(),                                          // Row number (1–20)
  description: z.string().min(1, 'Description required'), // Description of repair
  assessedTime: z.coerce.number().min(0),                  // Assessed Time
  actualTime: z.coerce.number().min(0),                    // Actual Time
  // Variance is auto-calculated: actualTime - assessedTime
});

const partRowSchema = z.object({
  no: z.number(),                                          // Row number (1–12)
  partNumber: z.string().optional(),                       // Part Number
  description: z.string().min(1, 'Description required'), // Description
  quantity: z.coerce.number().min(1, 'Qty required'),      // Quantity
});

const jobCardSchema = z.object({
  // Machine Information (REF-02 header)
  machineId: z.string().min(1, 'Fleet number is required'),
  serialNumber: z.string().optional(),                     // Serial Number
  depot: z.string().min(1, 'Depot is required'),           // Depot
  machineHours: z.coerce.number().min(0),                  // Machine Hours
  model: z.string().optional(),                            // Model (auto-filled from machine)
  date: z.string().min(1, 'Date is required'),             // Date

  // Repairs Required — up to 20 rows (REF-02)
  repairs: z.array(repairRowSchema).min(1, 'At least one repair entry required'),

  // Spare Parts Used — up to 12 rows (REF-02)
  spareParts: z.array(partRowSchema),

  // Work Completion (REF-02)
  startDateTime: z.string().min(1, 'Start date/time required'),   // Start Date / Time
  finishDateTime: z.string().optional(),                           // Finish Date / Time
  engineerName: z.string().min(2, 'Engineer name required'),       // Name (engineer who completed)
});

type JobCardFormData = z.infer<typeof jobCardSchema>;

interface JobCardDialogProps {
  open: boolean;
  onClose: () => void;
}

export function JobCardDialog({ open, onClose }: JobCardDialogProps) {
  const { data: machines } = useMachines();
  const { data: branches } = useBranches();
  const [submitting, setSubmitting] = useState(false);
  const createJobCardMutation = useCreateJobCard();
  const { setMachineStatus, addJobCard } = useAppStore();

  const form = useForm<JobCardFormData>({
    resolver: zodResolver(jobCardSchema),
    defaultValues: {
      date: new Date().toISOString().split('T')[0],
      machineHours: 0,
      repairs: [{ no: 1, description: '', assessedTime: 0, actualTime: 0 }],
      spareParts: [],
      startDateTime: '',
      finishDateTime: '',
      engineerName: '',
    },
  });

  const { fields: repairFields, append: appendRepair, remove: removeRepair } = useFieldArray({
    control: form.control,
    name: 'repairs',
  });

  const { fields: partFields, append: appendPart, remove: removePart } = useFieldArray({
    control: form.control,
    name: 'spareParts',
  });

  const onSubmit = async (data: JobCardFormData) => {
    setSubmitting(true);
    try {
      const machine = machines?.find(m => m.id === data.machineId);
      const branch = branches?.find(b => b.id === data.depot);

      const jobCardData = {
        ...data,
        fleetNo: machine?.assetNumber ?? data.machineId,
        status: 'Open' as const,
      };

      const now = new Date().toISOString();
      const jobCardRecord = {
        ...jobCardData,
        id: `jc-${Date.now()}`,
        reference: `JC-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
        createdAt: now,
        updatedAt: now,
      };

      addJobCard(jobCardRecord as any);
      await createJobCardMutation.mutateAsync(jobCardData);

      // STATE MACHINE TRANSITION: Job Card created → machine status → Under Repair (if not already)
      setMachineStatus(data.machineId, 'Under Repair', `Job Card ${jobCardRecord.reference} created`);

      toastSuccess(`Job Card ${jobCardRecord.reference} created — machine → Under Repair`);
      form.reset();
      onClose();
    } catch (error) {
      console.error('Job Card error:', error);
      toastError('Failed to create job card');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Job Card (REF-02)</DialogTitle>
          <DialogDescription>
            Workshop repair job card — repairs required, spare parts used, and work completion
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

            {/* MACHINE INFORMATION (REF-02 header — 6 fields) */}
            <Card className="p-4 bg-muted/30">
              <h3 className="text-sm font-semibold mb-3">Machine Information</h3>
              <div className="grid grid-cols-3 gap-4">
                <FormField control={form.control} name="machineId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fleet Number*</FormLabel>
                    <Select onValueChange={(val) => {
                      field.onChange(val);
                      const m = machines?.find(m => m.id === val);
                      if (m) {
                        form.setValue('model', `${m.make} ${m.model}`);
                        form.setValue('serialNumber', m.assetNumber);
                      }
                    }} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select fleet number" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {machines?.map(m => (
                          <SelectItem key={m.id} value={m.id}>{m.assetNumber} — {m.make} {m.model}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="serialNumber" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Serial Number</FormLabel>
                    <FormControl><Input placeholder="Manufacturer serial no." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="depot" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Depot*</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select depot" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {branches?.map(b => (
                          <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>
                        )) ?? ['DXB', 'AUH', 'TAW', 'OIL', 'FUJ', 'KSA'].map(d => (
                          <SelectItem key={d} value={d}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="machineHours" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Machine Hours*</FormLabel>
                    <FormControl><Input type="number" step="0.1" placeholder="Total operating hours" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="model" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Model</FormLabel>
                    <FormControl><Input placeholder="Auto-filled from fleet number" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="date" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date*</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </Card>

            {/* REPAIRS REQUIRED — up to 20 rows (REF-02) */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold">Repairs Required</h3>
                  <p className="text-xs text-muted-foreground">No. / Description / Assessed Time / Actual Time / Variance ± — up to 20 entries</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={repairFields.length >= 20}
                  onClick={() => appendRepair({ no: repairFields.length + 1, description: '', assessedTime: 0, actualTime: 0 })}
                >
                  <Plus className="h-4 w-4 mr-1" /> Add Row
                </Button>
              </div>

              {/* Column headers */}
              <div className="grid grid-cols-12 gap-2 mb-2 px-1">
                <span className="col-span-1 text-xs font-medium text-muted-foreground">No.</span>
                <span className="col-span-5 text-xs font-medium text-muted-foreground">Description</span>
                <span className="col-span-2 text-xs font-medium text-muted-foreground">Assessed</span>
                <span className="col-span-2 text-xs font-medium text-muted-foreground">Actual</span>
                <span className="col-span-1 text-xs font-medium text-muted-foreground">Variance</span>
                <span className="col-span-1"></span>
              </div>

              <div className="space-y-2">
                {repairFields.map((field, index) => {
                  const assessed = form.watch(`repairs.${index}.assessedTime`) || 0;
                  const actual = form.watch(`repairs.${index}.actualTime`) || 0;
                  const variance = actual - assessed;
                  return (
                    <div key={field.id} className="grid grid-cols-12 gap-2 items-center border rounded p-2">
                      <div className="col-span-1 text-xs font-bold text-muted-foreground text-center">
                        {index + 1}
                      </div>
                      <FormField control={form.control} name={`repairs.${index}.description`} render={({ field }) => (
                        <FormItem className="col-span-5 space-y-0">
                          <FormControl><Input placeholder="Repair description" className="h-8 text-xs" {...field} /></FormControl>
                          <FormMessage className="text-xs" />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`repairs.${index}.assessedTime`} render={({ field }) => (
                        <FormItem className="col-span-2 space-y-0">
                          <FormControl><Input type="number" step="0.5" placeholder="hrs" className="h-8 text-xs" {...field} /></FormControl>
                          <FormMessage className="text-xs" />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`repairs.${index}.actualTime`} render={({ field }) => (
                        <FormItem className="col-span-2 space-y-0">
                          <FormControl><Input type="number" step="0.5" placeholder="hrs" className="h-8 text-xs" {...field} /></FormControl>
                          <FormMessage className="text-xs" />
                        </FormItem>
                      )} />
                      <div className={`col-span-1 h-8 flex items-center justify-center rounded text-xs font-semibold ${
                        variance > 0 ? 'bg-rose-50 text-rose-700' :
                        variance < 0 ? 'bg-emerald-50 text-emerald-700' :
                        'bg-muted text-muted-foreground'
                      }`}>
                        {variance === 0 ? '—' : `${variance > 0 ? '+' : ''}${variance.toFixed(1)}`}
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="col-span-1 h-8 w-8"
                        onClick={() => removeRepair(index)} disabled={repairFields.length === 1}>
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-2">{repairFields.length}/20 rows used</p>
            </Card>

            {/* SPARE PARTS USED — up to 12 rows (REF-02) */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold">Spare Parts Used</h3>
                  <p className="text-xs text-muted-foreground">No. / Part Number / Description / Quantity — up to 12 entries</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={partFields.length >= 12}
                  onClick={() => appendPart({ no: partFields.length + 1, partNumber: '', description: '', quantity: 1 })}
                >
                  <Plus className="h-4 w-4 mr-1" /> Add Part
                </Button>
              </div>

              {partFields.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No parts added</p>
              )}

              {/* Column headers */}
              {partFields.length > 0 && (
                <div className="grid grid-cols-12 gap-2 mb-2 px-1">
                  <span className="col-span-1 text-xs font-medium text-muted-foreground">No.</span>
                  <span className="col-span-3 text-xs font-medium text-muted-foreground">Part Number</span>
                  <span className="col-span-6 text-xs font-medium text-muted-foreground">Description</span>
                  <span className="col-span-1 text-xs font-medium text-muted-foreground">Qty</span>
                  <span className="col-span-1"></span>
                </div>
              )}

              <div className="space-y-2">
                {partFields.map((field, index) => (
                  <div key={field.id} className="grid grid-cols-12 gap-2 items-center border rounded p-2">
                    <div className="col-span-1 text-xs font-bold text-muted-foreground text-center">
                      {index + 1}
                    </div>
                    <FormField control={form.control} name={`spareParts.${index}.partNumber`} render={({ field }) => (
                      <FormItem className="col-span-3 space-y-0">
                        <FormControl><Input placeholder="Part #" className="h-8 text-xs" {...field} /></FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name={`spareParts.${index}.description`} render={({ field }) => (
                      <FormItem className="col-span-6 space-y-0">
                        <FormControl><Input placeholder="Part description" className="h-8 text-xs" {...field} /></FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name={`spareParts.${index}.quantity`} render={({ field }) => (
                      <FormItem className="col-span-1 space-y-0">
                        <FormControl><Input type="number" min={1} className="h-8 text-xs" {...field} /></FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )} />
                    <Button type="button" variant="ghost" size="icon" className="col-span-1 h-8 w-8"
                      onClick={() => removePart(index)}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">{partFields.length}/12 rows used</p>
            </Card>

            {/* WORK COMPLETION (REF-02 — 3 fields) */}
            <Card className="p-4 bg-sky-50 dark:bg-sky-950/20 border-sky-200">
              <h3 className="text-sm font-semibold text-sky-900 dark:text-sky-100 mb-3">Work Completion</h3>
              <div className="grid grid-cols-3 gap-4">
                <FormField control={form.control} name="startDateTime" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date / Time*</FormLabel>
                    <FormControl><Input type="datetime-local" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="finishDateTime" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Finish Date / Time</FormLabel>
                    <FormControl><Input type="datetime-local" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="engineerName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name (Engineer)*</FormLabel>
                    <FormControl><Input placeholder="Engineer / technician name" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </Card>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creating...' : 'Create Job Card'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
