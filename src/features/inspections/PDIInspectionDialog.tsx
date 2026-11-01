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
import { useMachines, useCreatePDIInspection } from '@/hooks/useQueries';
import { toastSuccess, toastError } from '@/lib/toast-helper';
import { useAppStore } from '@/store/appStore';
import { useState } from 'react';

// Each item: Visual Inspection + Functional Check + Comments (same as PHI / REF-04 columns)
const checkItemSchema = z.object({
  visual:     z.enum(['Pass', 'Fail', 'N/A']),
  functional: z.enum(['Pass', 'Fail', 'N/A']),
  comments:   z.string().optional(),
});

const pdiSchema = z.object({
  // HEADER (REF-04 — 8 fields)
  depot:       z.string().min(1, 'Depot required'),
  fleetNo:     z.string().min(1, 'Fleet No. required'),
  serialNumber:z.string().optional(),
  model:       z.string().optional(),
  hours:       z.coerce.number().min(0, 'Hours required'),
  startTime:   z.string().min(1, 'Start time required'),
  finishTime:  z.string().optional(),
  docNo:       z.string().min(1, 'Doc No. required'),

  // SECTION A — Check All Emergency Operating Functions (12 items)
  sA1:  checkItemSchema, // Ignition key switch
  sA2:  checkItemSchema, // Key switch to emergency operation
  sA3:  checkItemSchema, // Emergency stop button
  sA4:  checkItemSchema, // Lift up/down
  sA5:  checkItemSchema, // Telescope in/out
  sA6:  checkItemSchema, // Slew left/right
  sA7:  checkItemSchema, // Cage rotate left/right
  sA8:  checkItemSchema, // Key switch to platform operation
  sA9:  checkItemSchema, // Tube handle for manual pump
  sA10: checkItemSchema, // Engine start/stop during running
  sA11: checkItemSchema, // Heater plugs
  sA12: checkItemSchema, // Emergency lowering (electric/manual)

  // SECTION B — Confirm All Functions Operate Correctly (14 items)
  sB1:  checkItemSchema, // Emergency stop button
  sB2:  checkItemSchema, // Foot switch
  sB3:  checkItemSchema, // Engine start & RPM increase
  sB4:  checkItemSchema, // Warning beacon / audibles / horn
  sB5:  checkItemSchema, // Steering left/right
  sB6:  checkItemSchema, // Cage level up/down
  sB7:  checkItemSchema, // Switch rubber seals
  sB8:  checkItemSchema, // Control lever locks
  sB9:  checkItemSchema, // Emergency pump
  sB10: checkItemSchema, // Driving forwards/backwards (fast/slow)
  sB11: checkItemSchema, // Boom function speed controller
  sB12: checkItemSchema, // High-drive cut-out
  sB13: checkItemSchema, // Braking distance
  sB14: checkItemSchema, // Tilt sensor works

  // SECTION B — Additional Scissor Lift Checks (5 items)
  sBs1: checkItemSchema, // Stabilisers function down/up
  sBs2: checkItemSchema, // Drive interlock off/on
  sBs3: checkItemSchema, // Stabilisers interlock over 8m
  sBs4: checkItemSchema, // Extension deck moving (electric/manual)
  sBs5: checkItemSchema, // Emergency lowering of extended platform

  // SECTION C — Confirm Following Have Been Checked (11 items)
  sC1:  checkItemSchema, // Battery distilled water
  sC2:  checkItemSchema, // Charger
  sC3:  checkItemSchema, // Battery plugs
  sC4:  checkItemSchema, // Power cable to the platform
  sC5:  checkItemSchema, // Independent closing of gates
  sC6:  checkItemSchema, // Engine oil
  sC7:  checkItemSchema, // Hydraulic oil
  sC8:  checkItemSchema, // Material handling equipment
  sC9:  checkItemSchema, // Charging cable and plug
  sC10: checkItemSchema, // Rail security
  sC11: checkItemSchema, // Protective guard system

  // SECTION D — Regulatory Requirements (8 items)
  sD1: checkItemSchema, // Decals (Cage/Emergency Operations)
  sD2: checkItemSchema, // Safe Working Load & Windspeed decals
  sD3: checkItemSchema, // Operating manual
  sD4: checkItemSchema, // Copy of thorough examination report
  sD5: checkItemSchema, // Battery charged
  sD6: checkItemSchema, // Machine refuelled
  sD7: checkItemSchema, // External damages
  sD8: checkItemSchema, // Stabiliser boards (tracked & vehicle)

  // FINAL APPROVAL (REF-04 — 4 fields)
  engineerNamePrint:         z.string().min(2, 'Engineer name required'),
  approvalDate:              z.string().min(1, 'Date required'),
  engineerSignature:         z.boolean().refine(v => v === true, 'Engineer signature required'),
  workshopManagerSignature:  z.boolean().refine(v => v === true, 'Workshop Manager signature required'),
});

type PDIFormData = z.infer<typeof pdiSchema>;

interface PDIInspectionDialogProps {
  open: boolean;
  onClose: () => void;
}

// Section A items — exact REF-04 labels
const sectionAItems = [
  { key: 'sA1',  no: '1',  label: 'Ignition key switch' },
  { key: 'sA2',  no: '2',  label: 'Key switch to emergency operation' },
  { key: 'sA3',  no: '3',  label: 'Emergency stop button' },
  { key: 'sA4',  no: '4',  label: 'Lift up/down' },
  { key: 'sA5',  no: '5',  label: 'Telescope in/out' },
  { key: 'sA6',  no: '6',  label: 'Slew left/right' },
  { key: 'sA7',  no: '7',  label: 'Cage rotate left/right' },
  { key: 'sA8',  no: '8',  label: 'Key switch to platform operation' },
  { key: 'sA9',  no: '9',  label: 'Tube handle for manual pump' },
  { key: 'sA10', no: '10', label: 'Engine start/stop during running' },
  { key: 'sA11', no: '11', label: 'Heater plugs' },
  { key: 'sA12', no: '12', label: 'Emergency lowering (electric/manual)' },
];

// Section B items — exact REF-04 labels
const sectionBItems = [
  { key: 'sB1',  no: '1',  label: 'Emergency stop button' },
  { key: 'sB2',  no: '2',  label: 'Foot switch' },
  { key: 'sB3',  no: '3',  label: 'Engine start & RPM increase' },
  { key: 'sB4',  no: '4',  label: 'Warning beacon / audibles / horn' },
  { key: 'sB5',  no: '5',  label: 'Steering left/right' },
  { key: 'sB6',  no: '6',  label: 'Cage level up/down' },
  { key: 'sB7',  no: '7',  label: 'Switch rubber seals' },
  { key: 'sB8',  no: '8',  label: 'Control lever locks' },
  { key: 'sB9',  no: '9',  label: 'Emergency pump' },
  { key: 'sB10', no: '10', label: 'Driving forwards/backwards (fast/slow)' },
  { key: 'sB11', no: '11', label: 'Boom function speed controller' },
  { key: 'sB12', no: '12', label: 'High-drive cut-out' },
  { key: 'sB13', no: '13', label: 'Braking distance' },
  { key: 'sB14', no: '14', label: 'Tilt sensor works' },
];

// Section B — Additional Scissor Lift checks
const sectionBScissorItems = [
  { key: 'sBs1', no: '15', label: 'Stabilisers function down/up' },
  { key: 'sBs2', no: '15', label: 'Drive interlock off/on' },
  { key: 'sBs3', no: '15', label: 'Stabilisers interlock over 8m' },
  { key: 'sBs4', no: '15', label: 'Extension deck moving (electric/manual)' },
  { key: 'sBs5', no: '15', label: 'Emergency lowering of extended platform' },
];

// Section C items
const sectionCItems = [
  { key: 'sC1',  no: '1',  label: 'Battery distilled water' },
  { key: 'sC2',  no: '2',  label: 'Charger' },
  { key: 'sC3',  no: '3',  label: 'Battery plugs' },
  { key: 'sC4',  no: '4',  label: 'Power cable to the platform' },
  { key: 'sC5',  no: '5',  label: 'Independent closing of gates' },
  { key: 'sC6',  no: '6',  label: 'Engine oil' },
  { key: 'sC7',  no: '7',  label: 'Hydraulic oil' },
  { key: 'sC8',  no: '8',  label: 'Material handling equipment' },
  { key: 'sC9',  no: '9',  label: 'Charging cable and plug' },
  { key: 'sC10', no: '10', label: 'Rail security' },
  { key: 'sC11', no: '11', label: 'Protective guard system' },
];

// Section D — Regulatory
const sectionDItems = [
  { key: 'sD1', no: '1', label: 'Decals (Cage/Emergency Operations)' },
  { key: 'sD2', no: '2', label: 'Safe Working Load & Windspeed decals' },
  { key: 'sD3', no: '3', label: 'Operating manual' },
  { key: 'sD4', no: '4', label: 'Copy of thorough examination report' },
  { key: 'sD5', no: '5', label: 'Battery charged' },
  { key: 'sD6', no: '6', label: 'Machine refuelled' },
  { key: 'sD7', no: '7', label: 'External damages' },
  { key: 'sD8', no: '8', label: 'Stabiliser boards (tracked & vehicle)' },
];

const allItems = [
  ...sectionAItems, ...sectionBItems, ...sectionBScissorItems,
  ...sectionCItems, ...sectionDItems,
];

const defaultCheck = { visual: 'Pass' as const, functional: 'Pass' as const, comments: '' };

export function PDIInspectionDialog({ open, onClose }: PDIInspectionDialogProps) {
  const { data: machines } = useMachines();
  const [submitting, setSubmitting] = useState(false);
  const createPDIMutation = useCreatePDIInspection();
  const { setMachineStatus, addInspection } = useAppStore();

  const form = useForm<PDIFormData>({
    resolver: zodResolver(pdiSchema),
    defaultValues: {
      docNo: `PDI-${Date.now()}`,
      hours: 0,
      approvalDate: new Date().toISOString().split('T')[0],
      engineerSignature: false,
      workshopManagerSignature: false,
      ...Object.fromEntries(allItems.map(i => [i.key, defaultCheck])),
    },
  });

  const onSubmit = async (data: PDIFormData) => {
    setSubmitting(true);
    try {
      const machine = machines?.find(m => m.id === data.fleetNo);

      // Count fails
      const allChecks = Object.entries(data).filter(([k]) => k.startsWith('s'));
      const failedChecks = allChecks.filter(([_, v]: any) => 
        v?.visual === 'Fail' || v?.functional === 'Fail'
      );

      const approved = data.engineerSignature && data.workshopManagerSignature && failedChecks.length === 0;

      // Create PDI inspection record
      const pdiRecord = {
        type: 'PDI',
        reference: `PDI-${Date.now()}`,
        machineId: data.fleetNo,
        fleetNo: machine?.assetNumber ?? data.fleetNo,
        result: approved ? 'Pass' : 'Fail',
        approvedForDelivery: approved,
        engineerNamePrint: data.engineerNamePrint,
        inspectionDate: data.approvalDate,
        formData: data,
      };

      // Save to appStore
      const now = new Date().toISOString();
      addInspection({
        ...pdiRecord,
        id: `insp-pdi-${Date.now()}`,
        createdAt: now,
        updatedAt: now,
      } as any);

      // Also call service for React Query invalidation
      await createPDIMutation.mutateAsync(pdiRecord);

      // STATE MACHINE TRANSITION (overview.md §4.2)
      if (approved) {
        // PDI approved → machine status → Available (ready for booking)
        setMachineStatus(data.fleetNo, 'Available', 'PDI approved — ready for booking');
        toastSuccess('PDI approved — machine → Available for booking');
      } else {
        // PDI failed → back to Under Repair (defects found)
        setMachineStatus(data.fleetNo, 'Under Repair', `PDI failed — ${failedChecks.length} defects found`);
        toastError(`PDI failed — ${failedChecks.length} defects, machine → Under Repair`);
      }

      form.reset();
      onClose();
    } catch (err) {
      console.error('PDI submission error:', err);
      toastError('Failed to submit PDI inspection');
    } finally {
      setSubmitting(false);
    }
  };

  // Reusable row — same Visual + Functional + Comments layout as PHI
  const CheckRow = ({ itemKey, no, label }: { itemKey: string; no: string; label: string }) => (
    <FormField
      control={form.control}
      name={itemKey as any}
      render={({ field }) => (
        <div className="grid grid-cols-12 gap-2 items-start border-b last:border-0 py-2">
          <div className="col-span-1 text-xs font-semibold text-muted-foreground pt-1">{no}</div>
          <div className="col-span-4 text-xs font-medium pt-1">{label}</div>
          {/* Visual Inspection */}
          <div className="col-span-3">
            <RadioGroup
              value={field.value?.visual}
              onValueChange={(v) => field.onChange({ ...field.value, visual: v })}
              className="flex gap-3"
            >
              {(['Pass', 'Fail', 'N/A'] as const).map(opt => (
                <div key={opt} className="flex items-center gap-1">
                  <RadioGroupItem value={opt} id={`${itemKey}-v-${opt}`} className="h-3 w-3" />
                  <Label htmlFor={`${itemKey}-v-${opt}`} className={`text-xs cursor-pointer ${opt === 'Pass' ? 'text-emerald-700' : opt === 'Fail' ? 'text-rose-700' : 'text-muted-foreground'}`}>{opt}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>
          {/* Functional Check */}
          <div className="col-span-3">
            <RadioGroup
              value={field.value?.functional}
              onValueChange={(v) => field.onChange({ ...field.value, functional: v })}
              className="flex gap-3"
            >
              {(['Pass', 'Fail', 'N/A'] as const).map(opt => (
                <div key={opt} className="flex items-center gap-1">
                  <RadioGroupItem value={opt} id={`${itemKey}-f-${opt}`} className="h-3 w-3" />
                  <Label htmlFor={`${itemKey}-f-${opt}`} className={`text-xs cursor-pointer ${opt === 'Pass' ? 'text-emerald-700' : opt === 'Fail' ? 'text-rose-700' : 'text-muted-foreground'}`}>{opt}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>
          {/* Comments — only shown on Fail */}
          <div className="col-span-1">
            {(field.value?.visual === 'Fail' || field.value?.functional === 'Fail') && (
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
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>PDI — Pre-Despatch Inspection (REF-04)</DialogTitle>
          <DialogDescription>
            Quality checklist before machine delivery to customer. All defects must be repaired before handover.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

            {/* HEADER — 8 fields (REF-04) */}
            <Card className="p-4 bg-muted/30">
              <h3 className="text-sm font-semibold mb-3">Header Information</h3>
              <div className="grid grid-cols-4 gap-4">
                <FormField control={form.control} name="depot" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Depot*</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select depot" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {['DXB', 'AUH', 'TAW', 'OIL', 'FUJ', 'KSA'].map(d => (
                          <SelectItem key={d} value={d}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="fleetNo" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fleet No.*</FormLabel>
                    <Select onValueChange={(val) => {
                      field.onChange(val);
                      const m = machines?.find(m => m.id === val);
                      if (m) {
                        form.setValue('model', `${m.make} ${m.model}`);
                        form.setValue('serialNumber', m.assetNumber);
                      }
                    }} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select fleet no." /></SelectTrigger></FormControl>
                      <SelectContent>
                        {machines?.map(m => (
                          <SelectItem key={m.id} value={m.id}>{m.assetNumber}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="serialNumber" render={({ field }) => (
                  <FormItem>
                    <FormLabel>S/N</FormLabel>
                    <FormControl><Input placeholder="Serial number" {...field} /></FormControl>
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

                <FormField control={form.control} name="hours" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hours*</FormLabel>
                    <FormControl><Input type="number" step="0.1" placeholder="Operating hours" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="startTime" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start*</FormLabel>
                    <FormControl><Input type="datetime-local" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="finishTime" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Finish</FormLabel>
                    <FormControl><Input type="datetime-local" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="docNo" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Doc No.*</FormLabel>
                    <FormControl><Input placeholder="PDI-001" {...field} /></FormControl>
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
                <div className="col-span-4 text-xs font-semibold">Inspection Item</div>
                <div className="col-span-3 text-xs font-semibold">Visual Inspection</div>
                <div className="col-span-3 text-xs font-semibold">Functional Check</div>
                <div className="col-span-1 text-xs font-semibold">Comments</div>
              </div>

              {/* SECTION A */}
              <div className="px-3 pt-2">
                <p className="text-xs font-bold text-sky-700 dark:text-sky-400 py-1 uppercase tracking-wide">
                  Section A — Check All Emergency Operating Functions
                </p>
                {sectionAItems.map(item => (
                  <CheckRow key={item.key} itemKey={item.key} no={item.no} label={item.label} />
                ))}
              </div>

              <Separator />

              {/* SECTION B */}
              <div className="px-3 pt-2">
                <p className="text-xs font-bold text-sky-700 dark:text-sky-400 py-1 uppercase tracking-wide">
                  Section B — Confirm All Functions Operate Correctly
                </p>
                {sectionBItems.map(item => (
                  <CheckRow key={item.key} itemKey={item.key} no={item.no} label={item.label} />
                ))}
                {/* Scissor Lift Additional Checks */}
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mt-3 mb-1">
                  Additional Checks — Scissor Lifts
                </p>
                {sectionBScissorItems.map(item => (
                  <CheckRow key={item.key} itemKey={item.key} no={item.no} label={item.label} />
                ))}
              </div>

              <Separator />

              {/* SECTION C */}
              <div className="px-3 pt-2">
                <p className="text-xs font-bold text-sky-700 dark:text-sky-400 py-1 uppercase tracking-wide">
                  Section C — Confirm Following Have Been Checked
                </p>
                {sectionCItems.map(item => (
                  <CheckRow key={item.key} itemKey={item.key} no={item.no} label={item.label} />
                ))}
              </div>

              <Separator />

              {/* SECTION D — Regulatory */}
              <div className="px-3 pt-2 pb-3">
                <p className="text-xs font-bold text-rose-700 dark:text-rose-400 py-1 uppercase tracking-wide">
                  Section D — Regulatory Requirements
                </p>
                {sectionDItems.map(item => (
                  <CheckRow key={item.key} itemKey={item.key} no={item.no} label={item.label} />
                ))}
              </div>
            </div>

            {/* FINAL APPROVAL (REF-04 — 4 fields) */}
            <Card className="p-4 bg-sky-50 dark:bg-sky-950/20 border-sky-200">
              <h3 className="text-sm font-semibold text-sky-900 dark:text-sky-100 mb-4">Final Approval</h3>
              <p className="text-xs text-sky-700 dark:text-sky-300 mb-4">
                Any defects found must be repaired before the machine is handed over to the customer.
              </p>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <FormField control={form.control} name="engineerNamePrint" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Engineer Name (Print)*</FormLabel>
                    <FormControl><Input placeholder="Full name printed" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="approvalDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date*</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-6">
                <FormField control={form.control} name="engineerSignature" render={({ field }) => (
                  <FormItem className="border rounded-lg p-3 bg-white dark:bg-background">
                    <FormLabel className="text-xs font-medium text-muted-foreground uppercase">Engineer Signature</FormLabel>
                    <div className="flex items-center gap-2 mt-2">
                      <input type="checkbox" id="pdi-eng-sig"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        className="h-4 w-4"
                      />
                      <Label htmlFor="pdi-eng-sig" className="text-sm cursor-pointer">
                        I confirm this PDI is accurate and complete
                      </Label>
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="workshopManagerSignature" render={({ field }) => (
                  <FormItem className="border rounded-lg p-3 bg-white dark:bg-background">
                    <FormLabel className="text-xs font-medium text-muted-foreground uppercase">Workshop Manager Signature</FormLabel>
                    <div className="flex items-center gap-2 mt-2">
                      <input type="checkbox" id="pdi-wm-sig"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        className="h-4 w-4"
                      />
                      <Label htmlFor="pdi-wm-sig" className="text-sm cursor-pointer">
                        I approve this PDI — machine cleared for delivery
                      </Label>
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </Card>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Submitting...' : 'Complete PDI & Approve Delivery'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
