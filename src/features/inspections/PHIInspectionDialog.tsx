import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useMachines, useBranches, useCreatePHIInspection, useCreateJobCard } from '@/hooks/useQueries';
import { toastSuccess, toastError } from '@/lib/toast-helper';
import { useAppStore } from '@/store/appStore';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { useState } from 'react';

// Each checklist item: Visual Inspection + Functional Check + Comments (REF-02 columns)
const checkItemSchema = z.object({
  visual: z.enum(['Pass', 'Fail', 'N/A']),
  functional: z.enum(['Pass', 'Fail', 'N/A']),
  comments: z.string().optional(),
});

const phiSchema = z.object({
  // INSPECTION HEADER (REF-02 Page 2)
  docNo: z.string().min(1, 'Doc No. required'),
  depot: z.string().min(1, 'Depot required'),
  fleetNo: z.string().min(1, 'Fleet No. required'),
  serialNumber: z.string().optional(),                    // S/N
  model: z.string().optional(),                           // Model (auto-filled)
  hours: z.coerce.number().min(0, 'Hours required'),      // Hours
  startTime: z.string().min(1, 'Start time required'),    // Start
  finishTime: z.string().optional(),                      // Finish

  // MANDATORY 4 PHOTOS BEFORE STARTING (REF-02)
  photoFront: z.instanceof(File).optional(),
  photoBack: z.instanceof(File).optional(),
  photoLeft: z.instanceof(File).optional(),
  photoRight: z.instanceof(File).optional(),

  // SECTION 1 — STATIC INSPECTION (1.1–1.19) — exact REF-02 items
  s1_1:  checkItemSchema, // Tyres and wheels
  s1_2:  checkItemSchema, // Steering
  s1_3:  checkItemSchema, // Chassis
  s1_4:  checkItemSchema, // Outriggers and ground plates
  s1_5:  checkItemSchema, // Turntable bearing and rotator
  s1_6:  checkItemSchema, // Torque hubs, brakes and motors
  s1_7:  checkItemSchema, // Mast, scissors, booms and pivoting points
  s1_8:  checkItemSchema, // Power tracks
  s1_9:  checkItemSchema, // Hydraulic cylinders and components
  s1_10: checkItemSchema, // Hydraulic hoses
  s1_11: checkItemSchema, // Electric cables and connectors
  s1_12: checkItemSchema, // Platform
  s1_13: checkItemSchema, // Rails / gates / drop bar
  s1_16: checkItemSchema, // Alarms, beacons and lights
  s1_17: checkItemSchema, // Batteries and battery charger
  s1_18: checkItemSchema, // Engine and fluid levels
  s1_19: checkItemSchema, // Hydraulic oil level and leaks

  // SECTION 2 — FUNCTION SET (2.1–2.9) — exact REF-02 items
  s2_1: checkItemSchema, // Test function level sensor
  s2_2: checkItemSchema, // Test all limit switches / security systems
  s2_3: checkItemSchema, // Test functions lower controls
  s2_4: checkItemSchema, // Test emergency descent
  s2_5: checkItemSchema, // Test generator
  s2_6: checkItemSchema, // Test functions upper controls
  s2_7: checkItemSchema, // Test functions accessories
  s2_8: checkItemSchema, // Stabilisers function down / up
  s2_9: checkItemSchema, // Drive interlock off / on

  // SECTION 3 — MAINTENANCE & APPEARANCE (3.1–3.5) — exact REF-02 items
  s3_1: checkItemSchema, // Cleaning
  s3_2: checkItemSchema, // Lubrication
  s3_3: checkItemSchema, // Test certificate and manual
  s3_4: checkItemSchema, // Succeed maintenance planning
  s3_5: checkItemSchema, // Fill up fuel / charge battery

  // FINAL APPROVAL (REF-02)
  machineReadyForRental: z.enum(['Yes', 'No']),           // Machine is ready for rental
  engineerNamePrint: z.string().min(2, 'Engineer name required'), // Engineer Name (Print)
  inspectionDate: z.string().min(1, 'Date required'),     // Date
  // Signatures are represented as confirmation checkboxes (digital)
  engineerSignature: z.boolean().refine(v => v === true, 'Engineer signature required'),
  workshopManagerSignature: z.boolean().refine(v => v === true, 'Workshop Manager signature required'),
});

type PHIFormData = z.infer<typeof phiSchema>;

interface PHIInspectionDialogProps {
  open: boolean;
  onClose: () => void;
}

// SECTION 1 — Static Inspection (1.1–1.19) exact REF-02 labels
const section1Items = [
  { key: 's1_1',  no: '1.1',  label: 'Tyres and wheels' },
  { key: 's1_2',  no: '1.2',  label: 'Steering' },
  { key: 's1_3',  no: '1.3',  label: 'Chassis' },
  { key: 's1_4',  no: '1.4',  label: 'Outriggers and ground plates' },
  { key: 's1_5',  no: '1.5',  label: 'Turntable bearing and rotator' },
  { key: 's1_6',  no: '1.6',  label: 'Torque hubs, brakes and motors' },
  { key: 's1_7',  no: '1.7',  label: 'Mast, scissors, booms and pivoting points' },
  { key: 's1_8',  no: '1.8',  label: 'Power tracks' },
  { key: 's1_9',  no: '1.9',  label: 'Hydraulic cylinders and components' },
  { key: 's1_10', no: '1.10', label: 'Hydraulic hoses' },
  { key: 's1_11', no: '1.11', label: 'Electric cables and connectors' },
  { key: 's1_12', no: '1.12', label: 'Platform' },
  { key: 's1_13', no: '1.13', label: 'Rails / gates / drop bar' },
  { key: 's1_16', no: '1.16', label: 'Alarms, beacons and lights' },
  { key: 's1_17', no: '1.17', label: 'Batteries and battery charger' },
  { key: 's1_18', no: '1.18', label: 'Engine and fluid levels' },
  { key: 's1_19', no: '1.19', label: 'Hydraulic oil level and leaks' },
];

// SECTION 2 — Function Set (2.1–2.9) exact REF-02 labels
const section2Items = [
  { key: 's2_1', no: '2.1', label: 'Test function level sensor' },
  { key: 's2_2', no: '2.2', label: 'Test all limit switches / security systems' },
  { key: 's2_3', no: '2.3', label: 'Test functions lower controls' },
  { key: 's2_4', no: '2.4', label: 'Test emergency descent' },
  { key: 's2_5', no: '2.5', label: 'Test generator' },
  { key: 's2_6', no: '2.6', label: 'Test functions upper controls' },
  { key: 's2_7', no: '2.7', label: 'Test functions accessories' },
  { key: 's2_8', no: '2.8', label: 'Stabilisers function down / up' },
  { key: 's2_9', no: '2.9', label: 'Drive interlock off / on' },
];

// SECTION 3 — Maintenance & Appearance (3.1–3.5) exact REF-02 labels
const section3Items = [
  { key: 's3_1', no: '3.1', label: 'Cleaning' },
  { key: 's3_2', no: '3.2', label: 'Lubrication' },
  { key: 's3_3', no: '3.3', label: 'Test certificate and manual' },
  { key: 's3_4', no: '3.4', label: 'Succeed maintenance planning' },
  { key: 's3_5', no: '3.5', label: 'Fill up fuel / charge battery' },
];

const allItems = [...section1Items, ...section2Items, ...section3Items];

const defaultCheck = { visual: 'Pass' as const, functional: 'Pass' as const, comments: '' };

export function PHIInspectionDialog({ open, onClose }: PHIInspectionDialogProps) {
  const { data: machines } = useMachines();
  const { data: branches } = useBranches();
  const [submitting, setSubmitting] = useState(false);
  const createPHIMutation = useCreatePHIInspection();
  const createJobCardMutation = useCreateJobCard();
  const { setMachineStatus, addInspection, addJobCard } = useAppStore();

  const form = useForm<PHIFormData>({
    resolver: zodResolver(phiSchema),
    defaultValues: {
      docNo: `PHI-${Date.now()}`,
      hours: 0,
      machineReadyForRental: 'Yes',
      inspectionDate: new Date().toISOString().split('T')[0],
      engineerSignature: false,
      workshopManagerSignature: false,
      ...Object.fromEntries(allItems.map(i => [i.key, defaultCheck])),
    },
  });

  const onSubmit = async (data: PHIFormData) => {
    setSubmitting(true);
    try {
      const machine = machines?.find(m => m.id === data.fleetNo);
      
      // Count fails
      const allChecks = Object.entries(data).filter(([k]) => k.startsWith('s'));
      const failedChecks = allChecks.filter(([_, v]: any) => 
        v?.visual === 'Fail' || v?.functional === 'Fail'
      );
      const defectsFound = failedChecks.map(([key, val]: any) => {
        const item = allItems.find(i => i.key === key);
        return `${item?.label}: ${val.comments || 'defect noted'}`;
      }).join('; ');

      const ready = data.machineReadyForRental === 'Yes' && failedChecks.length === 0;

      // Create PHI inspection record
      const phiRecord = {
        type: 'PHI',
        reference: `PHI-${Date.now()}`,
        machineId: data.fleetNo,
        fleetNo: machine?.assetNumber ?? data.fleetNo,
        result: ready ? 'Pass' : 'Fail',
        machineReadyForRental: data.machineReadyForRental,
        defectsFound,
        engineerNamePrint: data.engineerNamePrint,
        inspectionDate: data.inspectionDate,
        formData: data,
      };

      // Save to appStore
      const now = new Date().toISOString();
      const inspId = `insp-phi-${Date.now()}`;
      addInspection({
        ...phiRecord,
        id: inspId,
        createdAt: now,
        updatedAt: now,
      } as any);

      // Also call service for React Query invalidation
      await createPHIMutation.mutateAsync(phiRecord);

      // STATE MACHINE TRANSITIONS (overview.md §4.2)
      if (ready) {
        // machineReadyForRental = Yes → machine status → PDI
        setMachineStatus(data.fleetNo, 'PDI', 'PHI approved — ready for PDI');
        toastSuccess('PHI passed — machine moved to PDI');
      } else {
        // machineReadyForRental = No OR defects found → auto-create Job Card + status → Under Repair
        const jobCardId = `jc-auto-${Date.now()}`;
        const jobCardRecord = {
          id: jobCardId,
          reference: `JC-AUTO-${String(Date.now()).slice(-4)}`,
          machineId: data.fleetNo,
          fleetNo: machine?.assetNumber ?? data.fleetNo,
          model: data.model ?? machine?.model ?? '',
          serialNumber: data.serialNumber ?? machine?.assetNumber ?? '',
          depot: data.depot,
          machineHours: data.hours,
          date: data.inspectionDate || new Date().toISOString().split('T')[0],
          repairs: failedChecks.map(([key, val], idx) => {
            const item = allItems.find(i => i.key === key);
            const checkVal = val as { visual: string; functional: string; comments?: string };
            return {
              no: idx + 1,
              description: checkVal.comments || `Defect from PHI: ${item?.label}`,
              assessedTime: 2,
              actualTime: 0,
            };
          }),
          spareParts: [],
          startDateTime: now,
          engineerName: data.engineerNamePrint || 'Auto-generated',
          status: 'Open' as const,
          phiInspectionId: inspId,
          createdAt: now,
          updatedAt: now,
        };

        addJobCard(jobCardRecord);
        await createJobCardMutation.mutateAsync(jobCardRecord);

        setMachineStatus(data.fleetNo, 'Under Repair', `PHI failed — ${failedChecks.length} defects found, Job Card auto-created`);
        toastSuccess(`PHI defects found — Job Card ${jobCardRecord.reference} auto-created, machine → Under Repair`);
      }

      form.reset();
      onClose();
    } catch (err) {
      console.error('PHI submission error:', err);
      toastError('Failed to submit PHI inspection');
    } finally {
      setSubmitting(false);
    }
  };

  // Reusable row renderer
  const CheckRow = ({ itemKey, no, label }: { itemKey: string; no: string; label: string }) => (
    <FormField
      control={form.control}
      name={itemKey as any}
      render={({ field }) => (
        <div className="grid grid-cols-12 gap-2 items-start border-b last:border-0 py-2">
          {/* No. */}
          <div className="col-span-1 text-xs font-semibold text-muted-foreground pt-1">{no}</div>
          {/* Label */}
          <div className="col-span-4 text-xs font-medium pt-1">{label}</div>
          {/* Visual Inspection */}
          <div className="col-span-3">
            <RadioGroup
              value={field.value?.visual}
              onValueChange={(v) => field.onChange({ ...field.value, visual: v })}
              className="flex gap-3"
            >
              {['Pass', 'Fail', 'N/A'].map(opt => (
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
              {['Pass', 'Fail', 'N/A'].map(opt => (
                <div key={opt} className="flex items-center gap-1">
                  <RadioGroupItem value={opt} id={`${itemKey}-f-${opt}`} className="h-3 w-3" />
                  <Label htmlFor={`${itemKey}-f-${opt}`} className={`text-xs cursor-pointer ${opt === 'Pass' ? 'text-emerald-700' : opt === 'Fail' ? 'text-rose-700' : 'text-muted-foreground'}`}>{opt}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>
          {/* Comments */}
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
          <DialogTitle>Off-Hire Inspection — PHI (REF-02)</DialogTitle>
          <DialogDescription>
            Post-hire inspection checklist. 4 photos required before starting. Visual Inspection + Functional Check per item.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

            {/* MANDATORY 4 PHOTOS BEFORE STARTING (REF-02) */}
            <Card className="p-4 bg-rose-50 dark:bg-rose-950/20 border-rose-200">
              <div className="flex items-start gap-2 mb-3">
                <AlertTriangle className="h-5 w-5 text-rose-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-rose-900 dark:text-rose-100">
                    MANDATORY: 4 Photos of Machine BEFORE Starting Inspection
                  </h3>
                  <p className="text-xs text-rose-700 dark:text-rose-300">
                    All sides must be photographed first. This is JA's own written rule (REF-02).
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {[
                  { name: 'photoFront', label: 'Front' },
                  { name: 'photoBack',  label: 'Back' },
                  { name: 'photoLeft',  label: 'Left Side' },
                  { name: 'photoRight', label: 'Right Side' },
                ].map(p => (
                  <FormField key={p.name} control={form.control} name={p.name as any} render={({ field }) => (
                    <FormItem className="border rounded-lg p-2 bg-white dark:bg-background">
                      <FormLabel className="text-xs font-medium">{p.label}*</FormLabel>
                      <FormControl>
                        <Input type="file" accept="image/*" capture="environment"
                          onChange={(e) => field.onChange(e.target.files?.[0])}
                          className="text-xs h-8" />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )} />
                ))}
              </div>
            </Card>

            {/* INSPECTION HEADER (REF-02 Page 2 — 8 fields) */}
            <Card className="p-4 bg-muted/30">
              <h3 className="text-sm font-semibold mb-3">Inspection Header</h3>
              <div className="grid grid-cols-4 gap-4">
                <FormField control={form.control} name="docNo" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Doc No.*</FormLabel>
                    <FormControl><Input placeholder="PHI-001" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
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
                    <FormControl><Input type="number" step="0.1" placeholder="Machine hours" {...field} /></FormControl>
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
              </div>
            </Card>

            {/* CHECKLIST TABLE — column headers */}
            <div className="rounded-lg border overflow-hidden">
              <div className="grid grid-cols-12 gap-2 bg-muted px-3 py-2">
                <div className="col-span-1 text-xs font-semibold">No.</div>
                <div className="col-span-4 text-xs font-semibold">Inspection Item</div>
                <div className="col-span-3 text-xs font-semibold">Visual Inspection</div>
                <div className="col-span-3 text-xs font-semibold">Functional Check</div>
                <div className="col-span-1 text-xs font-semibold">Comments</div>
              </div>

              {/* SECTION 1 — Static Inspection */}
              <div className="px-3 pt-2">
                <p className="text-xs font-bold text-sky-700 dark:text-sky-400 py-1 uppercase tracking-wide">
                  Section 1 — Static Inspection
                </p>
                {section1Items.map(item => (
                  <CheckRow key={item.key} itemKey={item.key} no={item.no} label={item.label} />
                ))}
              </div>

              <Separator />

              {/* SECTION 2 — Function Set */}
              <div className="px-3 pt-2">
                <p className="text-xs font-bold text-sky-700 dark:text-sky-400 py-1 uppercase tracking-wide">
                  Section 2 — Function Set
                </p>
                {section2Items.map(item => (
                  <CheckRow key={item.key} itemKey={item.key} no={item.no} label={item.label} />
                ))}
              </div>

              <Separator />

              {/* SECTION 3 — Maintenance & Appearance */}
              <div className="px-3 pt-2 pb-3">
                <p className="text-xs font-bold text-sky-700 dark:text-sky-400 py-1 uppercase tracking-wide">
                  Section 3 — Maintenance &amp; Appearance
                </p>
                {section3Items.map(item => (
                  <CheckRow key={item.key} itemKey={item.key} no={item.no} label={item.label} />
                ))}
              </div>
            </div>

            {/* FINAL APPROVAL (REF-02) */}
            <Card className="p-4 bg-sky-50 dark:bg-sky-950/20 border-sky-200">
              <h3 className="text-sm font-semibold text-sky-900 dark:text-sky-100 mb-4">Final Approval</h3>

              {/* Machine Ready for Rental */}
              <FormField control={form.control} name="machineReadyForRental" render={({ field }) => (
                <FormItem className="mb-4">
                  <FormLabel className="text-sm font-semibold">Machine is ready for rental*</FormLabel>
                  <div className="flex gap-6 mt-2">
                    <RadioGroup value={field.value} onValueChange={field.onChange} className="flex gap-6">
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="Yes" id="rental-yes" />
                        <Label htmlFor="rental-yes" className="text-sm font-medium text-emerald-700 cursor-pointer">
                          ✅ Yes
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="No" id="rental-no" />
                        <Label htmlFor="rental-no" className="text-sm font-medium text-rose-700 cursor-pointer">
                          ❌ No
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-3 gap-4 mb-4">
                <FormField control={form.control} name="engineerNamePrint" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Engineer Name (Print)*</FormLabel>
                    <FormControl><Input placeholder="Full name printed" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="inspectionDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date*</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* Signatures */}
              <div className="grid grid-cols-2 gap-6">
                <FormField control={form.control} name="engineerSignature" render={({ field }) => (
                  <FormItem className="border rounded-lg p-3 bg-white dark:bg-background">
                    <FormLabel className="text-xs font-medium text-muted-foreground uppercase">Engineer Signature</FormLabel>
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        className="h-4 w-4"
                        id="eng-sig"
                      />
                      <Label htmlFor="eng-sig" className="text-sm cursor-pointer">
                        I confirm this inspection is accurate and complete
                      </Label>
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="workshopManagerSignature" render={({ field }) => (
                  <FormItem className="border rounded-lg p-3 bg-white dark:bg-background">
                    <FormLabel className="text-xs font-medium text-muted-foreground uppercase">Workshop Manager Signature</FormLabel>
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        className="h-4 w-4"
                        id="wm-sig"
                      />
                      <Label htmlFor="wm-sig" className="text-sm cursor-pointer">
                        I approve this inspection and the rental readiness decision
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
                {submitting ? 'Submitting...' : 'Complete PHI Inspection'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
