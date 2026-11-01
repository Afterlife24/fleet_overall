import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCreateMachine, useUpdateMachine, useBranches } from '@/hooks/useQueries';
import { toastSuccess, toastError } from '@/lib/toast-helper';
import { Machine } from '@/types';

// REF-09 Fleet Movement Master Sheet — all fields
const machineSchema = z.object({
  // ── FLEET IDENTITY ──────────────────────────────────────────
  fleetNo:       z.string().min(1, 'Fleet No. is required'),          // Fleet No
  model:         z.string().min(1, 'Model is required'),              // Model
  type:          z.enum(['B', 'S', 'PL', 'CB']),                     // Type (B/S/PL/CB)
  energy:        z.enum(['D', 'E', 'Bi', 'H']),                      // Energy (D/E/Bi/H)
  wh:            z.coerce.number().positive('Working height required'), // WH (working height m)
  branch:        z.string().min(1, 'Branch is required'),             // Branch
  status:        z.string().min(1, 'Status is required'),             // Status
  doa:           z.string().optional(),                               // DOA (Date of Arrival)
  supplier:      z.string().optional(),                               // Supplier

  // ── HIRE DETAILS ─────────────────────────────────────────────
  client:        z.string().optional(),                               // Client
  site:          z.enum(['Dubai', 'Abu Dhabi', 'Taweelah', 'Oilfields', 'Fujairah', 'KSA']).optional(), // Site
  specific:      z.string().optional(),                               // Specific (= "Yard" in yard)
  suppInLieu:    z.string().optional(),                               // Supp In Lieu For
  rate:          z.coerce.number().min(0).optional(),                 // Rate (rental rate)
  period:        z.enum(['D', 'W', 'M', '2D', '1D']).optional(),     // Period
  dailyRevenue:  z.coerce.number().min(0).optional(),                 // Daily Revenue
  mobDemob:      z.string().optional(),                               // Mob / Demob
  ha:            z.string().optional(),                               // H/A (Hire Agreement ref)
  startDate:     z.string().optional(),                               // Start Date
  endDate:       z.string().optional(),                               // End Date
  endDateHaSigned: z.string().optional(),                             // End Date – HA Signed
  rep:           z.enum(['BG', 'AD', 'CH', 'AM', 'SM', 'SK', 'TD', 'SH', 'MT']).optional(), // REP
  pt:            z.enum(['30', '45', '60', '90', 'Cash Advance', 'PDC']).optional(), // PT
  lpo:           z.string().optional(),                               // LPO
  lpoValidity:   z.string().optional(),                               // LPO Validity
  remarks:       z.string().optional(),                               // Remarks

  // ── TPC CERTIFICATE ──────────────────────────────────────────
  tpcExpiryDate: z.string().optional(),                               // TPC Expiry Date
  tpcSupplier:   z.string().optional(),                               // TPC Certifying Supplier

  // ── REPAIR ECONOMICS (REF-05 / REF-09) ───────────────────────
  hoursToRepair: z.coerce.number().min(0).optional(),                 // Hours to Repair
  costToRepair:  z.coerce.number().min(0).optional(),                 // Cost to Repair (AED)
  payBack:       z.coerce.number().min(0).optional(),                 // Pay Back (cost vs rate)
});

type MachineFormData = z.infer<typeof machineSchema>;

interface MachineFormDialogProps {
  open: boolean;
  onClose: () => void;
  machine?: Machine | null;
}

export function MachineFormDialog({ open, onClose, machine }: MachineFormDialogProps) {
  const { data: branches } = useBranches();
  const createMutation = useCreateMachine();
  const updateMutation = useUpdateMachine();
  const isEditing = !!machine;

  const form = useForm<MachineFormData>({
    resolver: zodResolver(machineSchema),
    defaultValues: machine ? {
      fleetNo:   machine.assetNumber,
      model:     machine.model,
      type:      'B',
      energy:    'D',
      wh:        (machine as any).workingHeight ?? 0,
      branch:    machine.branchId,
      status:    machine.status,
      suppInLieu: '',
    } : {
      type:   'B',
      energy: 'D',
      status: 'Available',
    },
  });

  const onSubmit = async (data: MachineFormData) => {
    try {
      const payload = { ...data, assetNumber: data.fleetNo } as any;
      if (isEditing) {
        await updateMutation.mutateAsync({ id: machine.id, data: payload });
        toastSuccess('Machine updated successfully');
      } else {
        await createMutation.mutateAsync(payload);
        toastSuccess('Machine created successfully');
      }
      form.reset();
      onClose();
    } catch {
      toastError(isEditing ? 'Failed to update machine' : 'Failed to create machine');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Machine' : 'Add New Machine'}</DialogTitle>
          <DialogDescription>
            Fleet Movement Master — REF-09
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

            {/* ── FLEET IDENTITY ── */}
            <Card className="p-4 bg-muted/30">
              <h3 className="text-sm font-semibold mb-3">Fleet Identity</h3>
              <div className="grid grid-cols-3 gap-4">
                <FormField control={form.control} name="fleetNo" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fleet No.*</FormLabel>
                    <FormControl><Input placeholder="J116" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="model" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Model*</FormLabel>
                    <FormControl><Input placeholder="660SJ" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="type" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type*</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="B">B — Boom Lift</SelectItem>
                        <SelectItem value="S">S — Scissor Lift</SelectItem>
                        <SelectItem value="PL">PL — Personnel Lift</SelectItem>
                        <SelectItem value="CB">CB — Crawler Boom</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="energy" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Energy*</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="D">D — Diesel</SelectItem>
                        <SelectItem value="E">E — Electric</SelectItem>
                        <SelectItem value="Bi">Bi — Bi-Energy</SelectItem>
                        <SelectItem value="H">H — Hybrid</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="wh" render={({ field }) => (
                  <FormItem>
                    <FormLabel>WH — Working Height (m)*</FormLabel>
                    <FormControl><Input type="number" step="0.1" placeholder="22.1" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="branch" render={({ field }) => (
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

                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status*</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {['Available', 'On Hire', 'PHI', 'PDI', 'WIP', 'Under Repair', 'In Transit', 'Sales'].map(s => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="doa" render={({ field }) => (
                  <FormItem>
                    <FormLabel>DOA (Date of Arrival)</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="supplier" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Supplier</FormLabel>
                    <FormControl><Input placeholder="Equipment supplier" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </Card>

            {/* ── HIRE DETAILS (REF-09) ── */}
            <Card className="p-4 bg-muted/30">
              <h3 className="text-sm font-semibold mb-3">Hire Details</h3>
              <div className="grid grid-cols-3 gap-4">
                <FormField control={form.control} name="client" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Client</FormLabel>
                    <FormControl><Input placeholder="Customer name" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="site" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Site</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select site" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {['Dubai', 'Abu Dhabi', 'Taweelah', 'Oilfields', 'Fujairah', 'KSA'].map(s => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="specific" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Specific</FormLabel>
                    <FormControl><Input placeholder='"Yard" or specific location' {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="suppInLieu" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Supp In Lieu For</FormLabel>
                    <FormControl><Input placeholder="Fleet no. this replaces" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="rate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rate (AED)</FormLabel>
                    <FormControl><Input type="number" step="0.01" placeholder="0.00" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="period" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Period</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select period" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="D">D — Daily</SelectItem>
                        <SelectItem value="W">W — Weekly</SelectItem>
                        <SelectItem value="M">M — Monthly</SelectItem>
                        <SelectItem value="2D">2D — 2 Day</SelectItem>
                        <SelectItem value="1D">1D — 1 Day</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="dailyRevenue" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Daily Revenue (AED)</FormLabel>
                    <FormControl><Input type="number" step="0.01" placeholder="0.00" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="mobDemob" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mob / Demob</FormLabel>
                    <FormControl><Input placeholder="Mob/demob charge or status" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="ha" render={({ field }) => (
                  <FormItem>
                    <FormLabel>H/A (Hire Agreement)</FormLabel>
                    <FormControl><Input placeholder="HA reference number" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="startDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="endDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Date</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="endDateHaSigned" render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Date – HA Signed</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="rep" render={({ field }) => (
                  <FormItem>
                    <FormLabel>REP (Sales Rep)</FormLabel>
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

                <FormField control={form.control} name="pt" render={({ field }) => (
                  <FormItem>
                    <FormLabel>PT (Payment Terms)</FormLabel>
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

                <FormField control={form.control} name="lpo" render={({ field }) => (
                  <FormItem>
                    <FormLabel>LPO</FormLabel>
                    <FormControl><Input placeholder="LPO number" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="lpoValidity" render={({ field }) => (
                  <FormItem>
                    <FormLabel>LPO Validity</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="remarks" render={({ field }) => (
                <FormItem className="mt-4">
                  <FormLabel>Remarks</FormLabel>
                  <FormControl><Textarea placeholder="Operational notes..." rows={2} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </Card>

            {/* ── TPC CERTIFICATE (REF-09) ── */}
            <Card className="p-4 bg-amber-50 dark:bg-amber-950/20 border-amber-200">
              <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-3">TPC Certificate</h3>
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="tpcExpiryDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>TPC Expiry Date</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="tpcSupplier" render={({ field }) => (
                  <FormItem>
                    <FormLabel>TPC Certifying Supplier</FormLabel>
                    <FormControl><Input placeholder="Certifying company" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </Card>

            {/* ── REPAIR ECONOMICS (REF-05 / REF-09) ── */}
            <Card className="p-4 bg-rose-50 dark:bg-rose-950/20 border-rose-200">
              <h3 className="text-sm font-semibold text-rose-900 dark:text-rose-100 mb-3">Repair Economics</h3>
              <div className="grid grid-cols-3 gap-4">
                <FormField control={form.control} name="hoursToRepair" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hours to Repair</FormLabel>
                    <FormControl><Input type="number" step="0.5" placeholder="0.0" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="costToRepair" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cost to Repair (AED)</FormLabel>
                    <FormControl><Input type="number" step="0.01" placeholder="0.00" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="payBack" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pay Back</FormLabel>
                    <FormControl><Input type="number" step="0.01" placeholder="0.00" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <p className="text-xs text-rose-700 dark:text-rose-300 mt-2">
                Pay Back = Cost to Repair ÷ Monthly Rate. Drives Sales fleet decision.
              </p>
            </Card>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending ? 'Saving...' : isEditing ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
