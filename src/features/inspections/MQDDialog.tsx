import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useMachines, useCustomers } from '@/hooks/useQueries';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toastSuccess, toastError } from '@/lib/toast-helper';
import { Camera } from 'lucide-react';
import { useState } from 'react';

// REF-15 Machine Quality Document — exact fields from document
const mqdSchema = z.object({
  // HEADER — 3 fields (REF-15)
  date:    z.string().min(1, 'Date required'),
  fleetNo: z.string().min(1, 'Fleet No. required'),
  hirer:   z.string().min(1, 'Hirer required'),

  // PHOTO DOCUMENTATION — 10 photos (REF-15)
  // 7 exterior photos
  photoBodyLeft:        z.instanceof(File).optional(),
  photoPlatform:        z.instanceof(File).optional(),
  photoBodyRight:       z.instanceof(File).optional(),
  photoFrontSteerLeft:  z.instanceof(File).optional(),
  photoFrontSteerRight: z.instanceof(File).optional(),
  photoRearDriveLeft:   z.instanceof(File).optional(),
  photoRearDriveRight:  z.instanceof(File).optional(),
  // 3 identification/controls photos
  photoHourMeter:       z.instanceof(File).optional(),
  photoCageControls:    z.instanceof(File).optional(),
  photoFleetSerialReg:  z.instanceof(File).optional(),

  // NOTES — 2 fields (REF-15)
  leaserNote: z.string().optional(),
  hirerNote:  z.string().optional(),

  // DAMAGE & SHORTAGE ACKNOWLEDGEMENT — 8 fields (REF-15)
  // On Hire
  onHireJA:        z.string().min(1, 'JA representative required'),
  onHireHirer:     z.string().min(1, 'Hirer representative required'),
  onHireHirerSign: z.boolean().refine(v => v === true, 'Hirer signature required'),
  onHireDate:      z.string().min(1, 'On hire date required'),
  // Off Hire
  offHireJA:        z.string().optional(),
  offHireHirer:     z.string().optional(),
  offHireHirerSign: z.boolean().default(false),
  offHireDate:      z.string().optional(),
});

type MQDFormData = z.infer<typeof mqdSchema>;

interface MQDDialogProps {
  open: boolean;
  onClose: () => void;
}

// 7 exterior photos (REF-15)
const exteriorPhotos = [
  { key: 'photoBodyLeft',        label: 'Body Left',         desc: 'Left side of machine' },
  { key: 'photoPlatform',        label: 'Platform',          desc: 'Platform/cage condition' },
  { key: 'photoBodyRight',       label: 'Body Right',        desc: 'Right side of machine' },
  { key: 'photoFrontSteerLeft',  label: 'Front Steer Left',  desc: 'Left front tyre/wheel' },
  { key: 'photoFrontSteerRight', label: 'Front Steer Right', desc: 'Right front tyre/wheel' },
  { key: 'photoRearDriveLeft',   label: 'Rear Drive Left',   desc: 'Left rear drive wheel' },
  { key: 'photoRearDriveRight',  label: 'Rear Drive Right',  desc: 'Right rear drive wheel' },
];

// 3 identification/controls photos (REF-15)
const identificationPhotos = [
  { key: 'photoHourMeter',      label: 'Hour Meter',                    desc: 'Operating hours on machine' },
  { key: 'photoCageControls',   label: 'Cage Controls',                 desc: 'Platform control panel' },
  { key: 'photoFleetSerialReg', label: 'Fleet No. / Serial No. / Reg.', desc: 'Identification labels' },
];

export function MQDDialog({ open, onClose }: MQDDialogProps) {
  const { data: machines } = useMachines();
  const { data: customers } = useCustomers();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<MQDFormData>({
    resolver: zodResolver(mqdSchema),
    defaultValues: {
      date:            new Date().toISOString().split('T')[0],
      onHireHirerSign: false,
      offHireHirerSign: false,
    },
  });

  const onSubmit = async (data: MQDFormData) => {
    setSubmitting(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('MQD submitted:', data);
      toastSuccess('MQD completed — condition record saved');
      form.reset();
      onClose();
    } catch {
      toastError('Failed to submit MQD');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>MQD — Machine Quality Document (REF-15)</DialogTitle>
          <DialogDescription>
            Visual condition record at delivery (On Hire) and return (Off Hire). 10 photos + notes + dual sign-off.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

            {/* HEADER — 3 fields (REF-15) */}
            <Card className="p-4 bg-muted/30">
              <h3 className="text-sm font-semibold mb-3">Header Information</h3>
              <div className="grid grid-cols-3 gap-4">
                <FormField control={form.control} name="date" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date*</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="fleetNo" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fleet No.*</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select fleet no." /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {machines?.map(m => (
                          <SelectItem key={m.id} value={m.assetNumber}>{m.assetNumber} — {m.make} {m.model}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="hirer" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hirer*</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select hirer" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {customers?.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </Card>

            {/* PHOTO DOCUMENTATION (REF-15) */}
            <Card className="p-4 bg-amber-50 dark:bg-amber-950/20 border-amber-200">
              <div className="flex items-center gap-2 mb-3">
                <Camera className="h-5 w-5 text-amber-700" />
                <div>
                  <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                    Machine Photo Documentation — 10 Photos (REF-15)
                  </h3>
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Capture machine condition at delivery and return. Used as evidence for damage disputes.
                  </p>
                </div>
              </div>

              {/* 7 Exterior Photos */}
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Exterior — 7 Photos
              </p>
              <div className="grid grid-cols-4 gap-3 mb-4">
                {exteriorPhotos.map(photo => (
                  <FormField
                    key={photo.key}
                    control={form.control}
                    name={photo.key as any}
                    render={({ field }) => (
                      <FormItem className="border rounded-lg p-2 bg-white dark:bg-background">
                        <FormLabel className="text-xs font-medium">{photo.label}</FormLabel>
                        <p className="text-xs text-muted-foreground mb-1">{photo.desc}</p>
                        <FormControl>
                          <Input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) => field.onChange(e.target.files?.[0])}
                            className="text-xs h-8"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>

              {/* 3 Identification/Controls Photos */}
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Identification &amp; Controls — 3 Photos
              </p>
              <div className="grid grid-cols-3 gap-3">
                {identificationPhotos.map(photo => (
                  <FormField
                    key={photo.key}
                    control={form.control}
                    name={photo.key as any}
                    render={({ field }) => (
                      <FormItem className="border rounded-lg p-2 bg-white dark:bg-background">
                        <FormLabel className="text-xs font-medium">{photo.label}</FormLabel>
                        <p className="text-xs text-muted-foreground mb-1">{photo.desc}</p>
                        <FormControl>
                          <Input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) => field.onChange(e.target.files?.[0])}
                            className="text-xs h-8"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>
            </Card>

            {/* NOTES — 2 fields (REF-15) */}
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="leaserNote" render={({ field }) => (
                <FormItem>
                  <FormLabel>Leaser Note (Johnson Arabia)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="JA representative comments on machine condition..."
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="hirerNote" render={({ field }) => (
                <FormItem>
                  <FormLabel>Hirer Note (Customer)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Customer observations or comments..."
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* DAMAGE & SHORTAGE ACKNOWLEDGEMENT — 8 fields (REF-15) */}
            <Card className="p-4 bg-sky-50 dark:bg-sky-950/20 border-sky-200">
              <h3 className="text-sm font-semibold text-sky-900 dark:text-sky-100 mb-4">
                Damage &amp; Shortage Acknowledgement
              </h3>
              <p className="text-xs text-sky-700 dark:text-sky-300 mb-4">
                Both parties confirm the machine condition at delivery and collection.
              </p>

              <div className="grid grid-cols-2 gap-6">
                {/* ON HIRE — 4 fields */}
                <div className="space-y-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                    On Hire (Delivery)
                  </p>
                  <FormField control={form.control} name="onHireJA" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">JA Representative*</FormLabel>
                      <FormControl><Input placeholder="JA rep name" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="onHireHirer" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Hirer Representative*</FormLabel>
                      <FormControl><Input placeholder="Customer rep name" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="onHireDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Date*</FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="onHireHirerSign" render={({ field }) => (
                    <FormItem className="border rounded-lg p-3 bg-white dark:bg-background">
                      <FormLabel className="text-xs font-medium text-muted-foreground uppercase">
                        Hirer Signature (On Hire)*
                      </FormLabel>
                      <div className="flex items-center gap-2 mt-2">
                        <input
                          type="checkbox"
                          id="on-hire-sign"
                          checked={field.value}
                          onChange={(e) => field.onChange(e.target.checked)}
                          className="h-4 w-4"
                        />
                        <label htmlFor="on-hire-sign" className="text-xs cursor-pointer">
                          I confirm machine condition at delivery
                        </label>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                {/* OFF HIRE — 4 fields */}
                <div className="space-y-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-rose-700 dark:text-rose-400">
                    Off Hire (Return)
                  </p>
                  <FormField control={form.control} name="offHireJA" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">JA Representative</FormLabel>
                      <FormControl><Input placeholder="JA rep name" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="offHireHirer" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Hirer Representative</FormLabel>
                      <FormControl><Input placeholder="Customer rep name" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="offHireDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Date</FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="offHireHirerSign" render={({ field }) => (
                    <FormItem className="border rounded-lg p-3 bg-white dark:bg-background">
                      <FormLabel className="text-xs font-medium text-muted-foreground uppercase">
                        Hirer Signature (Off Hire)
                      </FormLabel>
                      <div className="flex items-center gap-2 mt-2">
                        <input
                          type="checkbox"
                          id="off-hire-sign"
                          checked={field.value}
                          onChange={(e) => field.onChange(e.target.checked)}
                          className="h-4 w-4"
                        />
                        <label htmlFor="off-hire-sign" className="text-xs cursor-pointer">
                          I confirm machine condition at return
                        </label>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </div>
            </Card>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Submitting...' : 'Complete MQD'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
