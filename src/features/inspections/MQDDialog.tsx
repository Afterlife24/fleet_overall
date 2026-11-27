import { useForm, type FieldErrors, type Resolver } from 'react-hook-form';
import * as z from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ApiErrorNotice, describeApiError, errorText } from '@/components/common/ApiStatus';
import { toastError, toastSuccess } from '@/lib/toast-helper';
import { Camera } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSubmission } from '@/hooks/useApiResources';
import {
  MQD_FORM_SCHEMA_VERSION, attachMqdPhoto, fetchMqdReport, useCollectionWorld, useCreateMqdReport, useUpdateMqdReport,
} from '@/hooks/api/useCollectionApi';
import { mqdFromDto } from '@/services/api/collectionMappers';
import { browserOrgId } from '@/services/api/readAdapters';
import type { MqdRecord } from '@/types/collection';

// REF-15 Machine Quality Document: header, photos, notes and the damage and shortage acknowledgement.
const mqdSchema = z.object({
  // HEADER: report date, the booking it belongs to, its phase and the hirer
  date:     z.string().min(1, 'Date required'),
  bookingId: z.string().min(1, 'Booking required'),
  phase:    z.enum(['HIRE', 'COLLECTION']),
  collectionNoteId: z.string().optional(),
  hirer:    z.string().trim().min(1, 'Hirer required'),
  // PHOTO DOCUMENTATION: 10 photos (REF-15)
  photoBodyLeft:        z.instanceof(File).optional(),
  photoPlatform:        z.instanceof(File).optional(),
  photoBodyRight:       z.instanceof(File).optional(),
  photoFrontSteerLeft:  z.instanceof(File).optional(),
  photoFrontSteerRight: z.instanceof(File).optional(),
  photoRearDriveLeft:   z.instanceof(File).optional(),
  photoRearDriveRight:  z.instanceof(File).optional(),
  photoHourMeter:       z.instanceof(File).optional(),
  photoCageControls:    z.instanceof(File).optional(),
  photoFleetSerialReg:  z.instanceof(File).optional(),
  // NOTES: 2 fields (REF-15)
  leaserNote: z.string().optional(),
  hirerNote:  z.string().optional(),
  // DAMAGE & SHORTAGE ACKNOWLEDGEMENT: 8 fields (REF-15)
  onHireJA:        z.string().min(1, 'JA representative required'),
  onHireHirer:     z.string().min(1, 'Hirer representative required'),
  onHireHirerSign: z.boolean().refine(v => v === true, 'Hirer signature required'),
  onHireDate:      z.string().min(1, 'On hire date required'),
  offHireJA:        z.string().optional(),
  offHireHirer:     z.string().optional(),
  offHireHirerSign: z.boolean().default(false),
  offHireDate:      z.string().optional(),
}).superRefine((v, ctx) => {
  if (v.phase === 'COLLECTION' && !v.collectionNoteId) {
    ctx.addIssue({ code: 'custom', path: ['collectionNoteId'], message: 'Collection note required for a collection MQD' });
  }
});

type MQDFormData = z.infer<typeof mqdSchema>;

// @hookform/resolvers 3.x cannot read zod 4 errors, so the schema result is mapped to field errors here.
const mqdResolver: Resolver<MQDFormData> = async (values) => {
  const parsed = mqdSchema.safeParse(values);
  if (parsed.success) return { values: parsed.data, errors: {} };
  const errors: Record<string, { type: string; message: string }> = {};
  for (const issue of parsed.error.issues) {
    const name = String(issue.path[0] ?? '');
    if (name && !errors[name]) errors[name] = { type: issue.code, message: issue.message };
  }
  return { values: {}, errors: errors as FieldErrors<MQDFormData> };
};

interface MQDDialogProps {
  open: boolean;
  onClose: () => void;
  /** Edit mode: prefill from and patch this record. */
  record?: MqdRecord;
  onSaved?: (rec: MqdRecord) => void;
}

const PHOTO_KEYS = [
  'photoBodyLeft', 'photoPlatform', 'photoBodyRight', 'photoFrontSteerLeft', 'photoFrontSteerRight',
  'photoRearDriveLeft', 'photoRearDriveRight', 'photoHourMeter', 'photoCageControls', 'photoFleetSerialReg',
] as const;
const TEXT_KEYS = [
  'leaserNote', 'hirerNote', 'onHireJA', 'onHireHirer', 'onHireDate', 'offHireJA', 'offHireHirer', 'offHireDate',
] as const;
/** The server accepts PNG and JPEG images only. */
const PHOTO_MIME = ['image/png', 'image/jpeg'];

function defaultsFor(record?: MqdRecord): Partial<MQDFormData> {
  if (!record) {
    return {
      date: new Date().toISOString().split('T')[0], phase: 'HIRE', bookingId: '', hirer: '',
      onHireHirerSign: false, offHireHirerSign: false,
    };
  }
  const f = record.fields ?? {};
  const out: Record<string, unknown> = {
    date: record.date,
    bookingId: record.bookingId,
    phase: record.phase ?? 'HIRE',
    collectionNoteId: record.cnId ?? '',
    hirer: record.hirer,
    onHireHirerSign: f.onHireHirerSign === 'true',
    offHireHirerSign: f.offHireHirerSign === 'true',
  };
  for (const k of TEXT_KEYS) out[k] = f[k] ?? '';
  return out as Partial<MQDFormData>;
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

export function MQDDialog({ open, onClose, record, onSaved }: MQDDialogProps) {
  const world = useCollectionWorld();
  const bookings = useMemo(() => world.data?.bookings ?? [], [world.data]);
  const notes = useMemo(() => world.data?.notes ?? [], [world.data]);
  const createMqd = useCreateMqdReport();
  const updateMqd = useUpdateMqdReport();
  const submission = useSubmission();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [reloading, setReloading] = useState(false);
  const [latestRowVersion, setLatestRowVersion] = useState<number | null>(null);

  const form = useForm<MQDFormData>({
    resolver: mqdResolver,
    defaultValues: defaultsFor(record),
  });

  useEffect(() => {
    if (open) {
      form.reset(defaultsFor(record));
      setError(null);
      setLatestRowVersion(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record?.id]);

  const phase = form.watch('phase');
  const bookingId = form.watch('bookingId');
  const noteOptions = notes.filter((n) => n.bookingId === bookingId && n.status !== 'Cancelled');

  const reload = async () => {
    if (!record) return;
    setReloading(true);
    try {
      setLatestRowVersion((await fetchMqdReport(record.id)).rowVersion); // entered values are not touched
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setReloading(false);
    }
  };

  const onSubmit = async (data: MQDFormData) => {
    // Photos are checked first so nothing is saved when one cannot be stored.
    const photos = PHOTO_KEYS.flatMap((k) => (data[k] ? [{ key: k, file: data[k] as File }] : []));
    const badPhoto = photos.find((p) => !PHOTO_MIME.includes(p.file.type));
    if (badPhoto) {
      form.setError(badPhoto.key, { message: 'Photos must be PNG or JPEG images' });
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const fields: Record<string, unknown> = { ...(record?.fields ?? {}) };
      for (const k of TEXT_KEYS) fields[k] = (data[k] as string | undefined) ?? '';
      fields.onHireHirerSign = String(data.onHireHirerSign);
      fields.offHireHirerSign = String(data.offHireHirerSign);
      let saved: MqdRecord;
      let reportId: string;
      if (record) {
        const dto = await updateMqd.mutateAsync({
          id: record.id,
          rowVersion: Math.max(latestRowVersion ?? 0, record.rowVersion ?? 0),
          patch: { reportDate: data.date, hirerName: data.hirer.trim(), fields },
        });
        reportId = dto.id;
        saved = mqdFromDto(dto, { orgId: browserOrgId(), bookings: new Map(bookings.map((b) => [b.id, b])) });
      } else {
        const dto = await createMqd.mutateAsync({
          body: {
            bookingId: data.bookingId,
            phase: data.phase,
            ...(data.phase === 'COLLECTION' ? { collectionNoteId: data.collectionNoteId } : {}),
            reportDate: data.date,
            hirerName: data.hirer.trim(),
            formSchemaVersion: MQD_FORM_SCHEMA_VERSION,
            fields,
          },
          submissionId: submission.id(),
        });
        submission.renew();
        reportId = dto.id;
        saved = mqdFromDto(dto, { orgId: browserOrgId(), bookings: new Map(bookings.map((b) => [b.id, b])) });
      }
      // The report is saved; photo failures are reported without discarding it.
      const failed: string[] = [];
      for (const [i, p] of photos.entries()) {
        try {
          await attachMqdPhoto({
            mqdReportId: reportId, file: p.file, photoRole: p.key, displayOrder: i, submissionId: `${submission.id()}:${p.key}`,
          });
        } catch (err) {
          failed.push(`${p.key}: ${errorText(err)}`);
        }
      }
      if (failed.length > 0) toastError(`MQD saved, but ${failed.length} photo(s) were not stored. ${failed[0]}`);
      else toastSuccess('MQD completed: condition record saved');
      onSaved?.(saved);
      form.reset();
      onClose();
    } catch (err) {
      // Values stay in the form so they can be corrected and the same submission retried.
      setError(err);
      const names: Record<string, keyof MQDFormData> = {
        bookingId: 'bookingId', phase: 'phase', collectionNoteId: 'collectionNoteId', hirerName: 'hirer', reportDate: 'date',
      };
      for (const [name, message] of Object.entries(describeApiError(err).fieldErrors)) {
        const target = names[name];
        if (target) form.setError(target, { message });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>MQD: Machine Quality Document (REF-15)</DialogTitle>
          <DialogDescription>
            Visual condition record at delivery (On Hire) and return (Off Hire). 10 photos + notes + dual sign-off.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* HEADER */}
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
                <FormField control={form.control} name="phase" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phase*</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={!!record}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="HIRE">Hire (delivery) - HMQD</SelectItem>
                        <SelectItem value="COLLECTION">Collection (return) - MQD</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="bookingId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Booking*</FormLabel>
                    <Select
                      onValueChange={(v) => {
                        field.onChange(v);
                        form.setValue('collectionNoteId', '');
                        const b = bookings.find((x) => x.id === v);
                        if (b && !form.getValues('hirer')) form.setValue('hirer', b.customerName);
                      }}
                      value={field.value ?? ''}
                      disabled={!!record}
                    >
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select booking" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {bookings.map(b => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.reference} · {b.fleetNo || b.assetNo} · {b.customerName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                {phase === 'COLLECTION' && (
                  <FormField control={form.control} name="collectionNoteId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Collection Note*</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ''} disabled={!!record}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Select collection note" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {noteOptions.map(n => (
                            <SelectItem key={n.id} value={n.id}>{n.number}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
                <FormField control={form.control} name="hirer" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hirer*</FormLabel>
                    <FormControl><Input placeholder="Hirer name" {...field} /></FormControl>
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
                    Capture machine condition at delivery and return (PNG or JPEG). Used as evidence for damage disputes.
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
                            accept="image/png,image/jpeg"
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
                            accept="image/png,image/jpeg"
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

            {error != null && (
              <ApiErrorNotice error={error} onReload={record ? () => void reload() : undefined} reloading={reloading} />
            )}
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
