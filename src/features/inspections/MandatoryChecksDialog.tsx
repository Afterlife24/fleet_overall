import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useMachines } from '@/hooks/useQueries';
import { toastSuccess, toastError } from '@/lib/toast-helper';
import { useState } from 'react';

// Standard check item — Done / Not Done / N/A
const checkSchema = z.object({
  status:   z.enum(['Done', 'Not Done', 'N/A']),
  comments: z.string().optional(),
});

const mandatoryChecksSchema = z.object({
  // HEADER — 3 fields (REF-03)
  fleetNo:       z.string().min(1, 'Fleet No. required'),
  model:         z.string().optional(),                    // auto-filled
  engineerName:  z.string().min(2, 'Engineer name required'),

  // MECHANICAL WORK — 16 items (REF-03)
  m1:  checkSchema, // Machine for Service (Yes/No)
  m2:  checkSchema, // Fan Belt & Timing Belt
  m3:  checkSchema, // Engine Mounting
  m4:  checkSchema, // Slew Bearing & Bolts
  m5:  checkSchema, // Swing Motor Bolts
  m6:  checkSchema, // Slew Bearing Lubrication
  m7:  checkSchema, // Torque Hub Mounting Bolts
  m8:  checkSchema, // Torque Hub Gear Oil
  m9:  checkSchema, // Tyres & Wheel Nuts
  m10: checkSchema, // Teleboom Wear Pads
  m11: checkSchema, // Power Track Cable Lubrication
  m12: checkSchema, // Scissor Pivot Pin Lock Bolts
  m13: checkSchema, // Hydraulic Hoses
  m14: checkSchema, // DTI Test (>20m machines)
  m15: checkSchema, // Cage Rotate Bolts
  m16: checkSchema, // Ropes

  // DTI measured value — numeric (only for machines >20m)
  dtiValue:   z.coerce.number().optional(), // DTI test value
  dtiInches:  z.coerce.number().optional(), // DTI test inches

  // ELECTRICAL JOBS — 12 items (REF-03)
  e1:  checkSchema,  // Alternator Assembly & Components
  e2:  checkSchema,  // Alternator Output
  e3:  checkSchema,  // Alternator Tachometer Output
  e4:  checkSchema,  // Engine Safety Switches
  e5:  checkSchema,  // Engine Electrical Wiring
  e6:  checkSchema,  // Ground Control Wiring
  e7:  checkSchema,  // Battery Voltage
  e8:  checkSchema,  // Battery Water/Cables/Charging System
  e9:  checkSchema,  // Limit Switches
  e10: checkSchema,  // Safety Operations of Limit Switches
  e11: checkSchema,  // Platform Control & Wiring
  e12: checkSchema,  // Machine Speed Function Test

  // Electrical measured values (REF-03)
  alternatorOutputVDC:    z.coerce.number().optional(), // Alternator Output (VDC)
  tachometerOutputVDC:    z.coerce.number().optional(), // Tachometer Output (VDC)
  battery1Voltage:        z.coerce.number().optional(), // Battery 1 voltage
  battery2Voltage:        z.coerce.number().optional(), // Battery 2 voltage
  battery3Voltage:        z.coerce.number().optional(), // Battery 3 voltage
  battery4Voltage:        z.coerce.number().optional(), // Battery 4 voltage

  // PAINTERS — 5 items (REF-03)
  p1: checkSchema, // Operation Manual
  p2: checkSchema, // Decals
  p3: checkSchema, // Diesel
  p4: checkSchema, // Electric Machine Charging
  p5: checkSchema, // Paint Machine
});

type MandatoryChecksFormData = z.infer<typeof mandatoryChecksSchema>;

interface MandatoryChecksDialogProps {
  open: boolean;
  onClose: () => void;
}

// MECHANICAL WORK — 16 items, exact REF-03 labels
const mechanicalItems = [
  { key: 'm1',  no: '1',  label: 'Machine for Service (Yes/No)' },
  { key: 'm2',  no: '2',  label: 'Fan Belt & Timing Belt' },
  { key: 'm3',  no: '3',  label: 'Engine Mounting' },
  { key: 'm4',  no: '4',  label: 'Slew Bearing & Bolts' },
  { key: 'm5',  no: '5',  label: 'Swing Motor Bolts' },
  { key: 'm6',  no: '6',  label: 'Slew Bearing Lubrication' },
  { key: 'm7',  no: '7',  label: 'Torque Hub Mounting Bolts' },
  { key: 'm8',  no: '8',  label: 'Torque Hub Gear Oil' },
  { key: 'm9',  no: '9',  label: 'Tyres & Wheel Nuts' },
  { key: 'm10', no: '10', label: 'Teleboom Wear Pads' },
  { key: 'm11', no: '11', label: 'Power Track Cable Lubrication' },
  { key: 'm12', no: '12', label: 'Scissor Pivot Pin Lock Bolts' },
  { key: 'm13', no: '13', label: 'Hydraulic Hoses' },
  { key: 'm14', no: '14', label: 'DTI Test (>20m Machines)' },
  { key: 'm15', no: '15', label: 'Cage Rotate Bolts' },
  { key: 'm16', no: '16', label: 'Ropes' },
];

// ELECTRICAL JOBS — 12 items, exact REF-03 labels
const electricalItems = [
  { key: 'e1',  no: '1',  label: 'Alternator Assembly & Components' },
  { key: 'e2',  no: '2',  label: 'Alternator Output' },
  { key: 'e3',  no: '3',  label: 'Alternator Tachometer Output' },
  { key: 'e4',  no: '4',  label: 'Engine Safety Switches' },
  { key: 'e5',  no: '5',  label: 'Engine Electrical Wiring' },
  { key: 'e6',  no: '6',  label: 'Ground Control Wiring' },
  { key: 'e7',  no: '7',  label: 'Battery Voltage' },
  { key: 'e8',  no: '8',  label: 'Battery Water/Cables/Charging System' },
  { key: 'e9',  no: '9',  label: 'Limit Switches' },
  { key: 'e10', no: '10', label: 'Safety Operations of Limit Switches' },
  { key: 'e11', no: '11', label: 'Platform Control & Wiring' },
  { key: 'e12', no: '12', label: 'Machine Speed Function Test' },
];

// PAINTERS — 5 items, exact REF-03 labels
const paintersItems = [
  { key: 'p1', no: '1', label: 'Operation Manual' },
  { key: 'p2', no: '2', label: 'Decals' },
  { key: 'p3', no: '3', label: 'Diesel' },
  { key: 'p4', no: '4', label: 'Electric Machine Charging' },
  { key: 'p5', no: '5', label: 'Paint Machine' },
];

const allItems = [...mechanicalItems, ...electricalItems, ...paintersItems];
const defaultCheck = { status: 'Done' as const, comments: '' };

export function MandatoryChecksDialog({ open, onClose }: MandatoryChecksDialogProps) {
  const { data: machines } = useMachines();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<MandatoryChecksFormData>({
    resolver: zodResolver(mandatoryChecksSchema),
    defaultValues: {
      engineerName: '',
      ...Object.fromEntries(allItems.map(i => [i.key, defaultCheck])),
    },
  });

  const onSubmit = async (data: MandatoryChecksFormData) => {
    setSubmitting(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('Mandatory Checks submitted:', data);
      toastSuccess('Mandatory checks completed successfully');
      form.reset();
      onClose();
    } catch {
      toastError('Failed to submit mandatory checks');
    } finally {
      setSubmitting(false);
    }
  };

  // Reusable check row
  const CheckRow = ({ itemKey, no, label }: { itemKey: string; no: string; label: string }) => (
    <FormField
      control={form.control}
      name={itemKey as any}
      render={({ field }) => (
        <div className="grid grid-cols-12 gap-2 items-start border-b last:border-0 py-2">
          <div className="col-span-1 text-xs font-semibold text-muted-foreground pt-1">{no}</div>
          <div className="col-span-5 text-xs font-medium pt-1">{label}</div>
          <div className="col-span-4">
            <RadioGroup
              value={field.value?.status}
              onValueChange={(v) => field.onChange({ ...field.value, status: v })}
              className="flex gap-4"
            >
              {(['Done', 'Not Done', 'N/A'] as const).map(opt => (
                <div key={opt} className="flex items-center gap-1">
                  <RadioGroupItem value={opt} id={`${itemKey}-${opt}`} className="h-3 w-3" />
                  <Label
                    htmlFor={`${itemKey}-${opt}`}
                    className={`text-xs cursor-pointer ${
                      opt === 'Done' ? 'text-emerald-700' :
                      opt === 'Not Done' ? 'text-rose-700' :
                      'text-muted-foreground'
                    }`}
                  >
                    {opt}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
          <div className="col-span-2">
            {field.value?.status === 'Not Done' && (
              <Input
                placeholder="Comment"
                className="h-7 text-xs"
                value={field.value?.comments || ''}
                onChange={(e) => field.onChange({ ...field.value, comments: e.target.value })}
              />
            )}
          </div>
        </div>
      )}
    />
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mandatory Checks (REF-03)</DialogTitle>
          <DialogDescription>
            Mechanic mandatory checklist — Mechanical Work (16), Electrical Jobs (12), Painters (5)
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

            {/* HEADER — 3 fields (REF-03) */}
            <Card className="p-4 bg-muted/30">
              <h3 className="text-sm font-semibold mb-3">Header Information</h3>
              <div className="grid grid-cols-3 gap-4">
                <FormField control={form.control} name="fleetNo" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fleet No.*</FormLabel>
                    <Select onValueChange={(val) => {
                      field.onChange(val);
                      const m = machines?.find(m => m.id === val);
                      if (m) form.setValue('model', `${m.make} ${m.model}`);
                    }} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select fleet no." /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {machines?.map(m => (
                          <SelectItem key={m.id} value={m.id}>{m.assetNumber}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="model" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Model</FormLabel>
                    <FormControl><Input placeholder="Auto-filled" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="engineerName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Engineer Name*</FormLabel>
                    <FormControl><Input placeholder="Mechanic / engineer name" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </Card>

            {/* CHECKLIST TABLE */}
            <div className="rounded-lg border overflow-hidden">
              {/* Column headers */}
              <div className="grid grid-cols-12 gap-2 bg-muted px-3 py-2">
                <div className="col-span-1 text-xs font-semibold">No.</div>
                <div className="col-span-5 text-xs font-semibold">Check Item</div>
                <div className="col-span-4 text-xs font-semibold">Status</div>
                <div className="col-span-2 text-xs font-semibold">Comments</div>
              </div>

              {/* MECHANICAL WORK — 16 items */}
              <div className="px-3 pt-2">
                <p className="text-xs font-bold text-sky-700 dark:text-sky-400 py-1 uppercase tracking-wide">
                  Mechanical Work
                </p>
                {mechanicalItems.map(item => (
                  <CheckRow key={item.key} itemKey={item.key} no={item.no} label={item.label} />
                ))}

                {/* DTI measured values — shown after m14 */}
                <div className="my-3 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded-lg">
                  <p className="text-xs font-semibold text-amber-900 dark:text-amber-100 mb-2">
                    DTI Test Measured Values (Record for machines &gt;20m)
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="dtiValue" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">DTI Value</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.001" placeholder="0.000" className="h-8" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="dtiInches" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">DTI Inches</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.001" placeholder="0.000" className="h-8" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>
              </div>

              <Separator />

              {/* ELECTRICAL JOBS — 12 items */}
              <div className="px-3 pt-2">
                <p className="text-xs font-bold text-sky-700 dark:text-sky-400 py-1 uppercase tracking-wide">
                  Electrical Jobs
                </p>
                {electricalItems.map(item => (
                  <CheckRow key={item.key} itemKey={item.key} no={item.no} label={item.label} />
                ))}

                {/* Electrical measured values */}
                <div className="my-3 p-3 bg-violet-50 dark:bg-violet-950/20 border border-violet-200 rounded-lg">
                  <p className="text-xs font-semibold text-violet-900 dark:text-violet-100 mb-3">
                    Electrical Measured Values (Record actual readings)
                  </p>
                  <div className="grid grid-cols-3 gap-4 mb-3">
                    <FormField control={form.control} name="alternatorOutputVDC" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Alternator Output (VDC)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.1" placeholder="0.0" className="h-8" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="tachometerOutputVDC" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Tachometer Output (VDC)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.1" placeholder="0.0" className="h-8" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Battery Voltages (V)</p>
                  <div className="grid grid-cols-4 gap-4">
                    {[
                      { name: 'battery1Voltage', label: 'Battery 1' },
                      { name: 'battery2Voltage', label: 'Battery 2' },
                      { name: 'battery3Voltage', label: 'Battery 3' },
                      { name: 'battery4Voltage', label: 'Battery 4' },
                    ].map(b => (
                      <FormField key={b.name} control={form.control} name={b.name as any} render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">{b.label} (V)</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.1" placeholder="12.6" className="h-8" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    ))}
                  </div>
                </div>
              </div>

              <Separator />

              {/* PAINTERS — 5 items */}
              <div className="px-3 pt-2 pb-3">
                <p className="text-xs font-bold text-sky-700 dark:text-sky-400 py-1 uppercase tracking-wide">
                  Painters
                </p>
                {paintersItems.map(item => (
                  <CheckRow key={item.key} itemKey={item.key} no={item.no} label={item.label} />
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Submitting...' : 'Complete Mandatory Checks'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
