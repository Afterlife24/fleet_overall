import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCreateGateEntry, useMachines } from '@/hooks/useQueries';
import { toastSuccess, toastError } from '@/lib/toast-helper';
import { useAppStore } from '@/store/appStore';
import { JA_ORG_ID, useAuthStore } from '@/store/authStore';
import { fleetNumberOf, type MachineLite, type QrError } from '@/services/collectionCore';
import { markCollectedForMachine } from '@/services/collectionDocs';
import {
  CAMERA_MESSAGES,
  GATE_SCAN_MESSAGES,
  buildGateRecordFields,
  directionFor,
  resolveGateScan,
  type CameraErrorCode,
} from '@/services/gateCore';
import { serverNow, type ServerTime } from '@/services/serverClock';
import { appMachineResolver, toMachineLite } from '@/features/fleet/collectionWiring';
import { QrScanner } from './QrScanner';

// REF-06 Â§5.1 Gate Capture â€” ONE page, under 60 seconds, works offline
// Fields: QR scan OR fleet number, photo of truck/load, arriving-from, truck plate, submit
const gatePassSchema = z.object({
  // Scan QR or type fleet number (REF-06 Â§5.1)
  machineId:     z.string().min(1, 'Fleet number is required'),
  // Photo of truck/load (REF-06 Â§5.1)
  truckPhoto:    z.instanceof(File).optional(),
  // Arriving-from â€” site/yard picklist (REF-06 Â§5.1)
  arrivingFrom:  z.enum(['Yard', 'Dubai', 'Abu Dhabi', 'Taweelah', 'Oilfields', 'Fujairah', 'KSA', 'External']),
  // Truck plate (REF-06 Â§5.1)
  truckPlate:    z.string().min(2, 'Truck plate is required'),
});

type GatePassFormData = z.infer<typeof gatePassSchema>;

type Mode = 'scan' | 'manual';

interface ScanResult {
  machine: MachineLite;
  payload: string;
  capturedAt: ServerTime;
  warnNotOnHire: boolean;
  gateDate: string;
  gateTime: string;
  gateTimeZone: string;
}

const TIME_ERROR = 'Could not get the time. Try again.';
const STATUS_ERROR = 'Machine status is unavailable';

const isValidIso = (iso: string | undefined): iso is string =>
  typeof iso === 'string' && !Number.isNaN(Date.parse(iso));

const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

interface GatePassDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenPass?: (id: string) => void;
}

export function GatePassDialog({ open, onClose }: GatePassDialogProps) {
  const { data: machines } = useMachines();
  const createMutation = useCreateGateEntry();
  const { setMachineStatus, getMachineCurrentStatus } = useAppStore();
  const orgId = useAuthStore((s) => s.user?.orgId ?? JA_ORG_ID);

  const [mode, setMode] = useState<Mode>('scan');
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<{ code: QrError; message: string } | null>(null);
  const [cameraError, setCameraError] = useState<CameraErrorCode | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [scanKey, setScanKey] = useState(0);
  // Bumped whenever a pending scan must be ignored (mode switch, scan again, reopen).
  const scanToken = useRef(0);

  const form = useForm<GatePassFormData>({
    resolver: zodResolver(gatePassSchema),
    defaultValues: {
      machineId: '',
      arrivingFrom: 'Yard',
    },
  });

  const clearScanState = useCallback(() => {
    scanToken.current += 1;
    setScan(null);
    setScanError(null);
    setCameraError(null);
    setInlineError(null);
    form.setValue('machineId', '');
  }, [form]);

  // Opening always starts in Scan_Mode with no scan data.
  useEffect(() => {
    if (!open) return;
    setMode('scan');
    clearScanState();
    setScanKey((k) => k + 1);
  }, [open, clearScanState]);

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    clearScanState();
    if (next === 'scan') setScanKey((k) => k + 1);
    setMode(next);
  };

  const scanAgain = () => {
    clearScanState();
    setScanKey((k) => k + 1);
  };

  const handleDecode = async (text: string) => {
    const token = ++scanToken.current;
    const result = resolveGateScan(text, orgId, appMachineResolver.list(orgId));
    if (!result.ok) {
      setScanError({ code: result.error, message: GATE_SCAN_MESSAGES[result.error] });
      return;
    }
    const machine = result.machine;

    let warnNotOnHire = false;
    try {
      warnNotOnHire = directionFor(getMachineCurrentStatus(machine.id)) !== 'IN';
    } catch {
      // Status is read again at submit, which blocks the save if it still fails.
    }

    try {
      const capturedAt = await serverNow();
      if (token !== scanToken.current) return;
      if (!isValidIso(capturedAt?.iso)) throw new RangeError('Invalid time');
      const gateTimeZone = deviceTimeZone();
      const fields = buildGateRecordFields(capturedAt.iso, gateTimeZone, machine, 'QR', capturedAt.source, text);
      form.setValue('machineId', machine.id);
      setScan({
        machine,
        payload: text,
        capturedAt,
        warnNotOnHire,
        gateDate: fields.gateDate,
        gateTime: fields.gateTime,
        gateTimeZone,
      });
    } catch {
      if (token !== scanToken.current) return;
      setInlineError(TIME_ERROR);
      setScanKey((k) => k + 1);
    }
  };

  const onSubmit = async (data: GatePassFormData) => {
    if (mode === 'scan' && !scan) return;
    setInlineError(null);

    let currentStatus: string;
    try {
      currentStatus = getMachineCurrentStatus(data.machineId);
    } catch {
      setInlineError(STATUS_ERROR);
      return;
    }
    // Determine direction based on current status (overview.md Â§4.2)
    // If machine is On Hire â†’ coming back IN (off-hire)
    // If machine is Available/PDI/Allocated â†’ going OUT (delivery)
    const direction = directionFor(currentStatus);

    const machine = machines?.find((m) => m.id === data.machineId);
    const lite: MachineLite | undefined =
      mode === 'scan' ? scan?.machine : machine ? toMachineLite(machine, orgId) : undefined;
    const liteForFields = lite ?? { fleetNo: undefined, assetNumber: data.machineId };

    let fields: ReturnType<typeof buildGateRecordFields>;
    try {
      let capture: ServerTime | undefined;
      if (mode === 'scan') capture = scan?.capturedAt;
      else capture = await serverNow();
      if (!capture || !isValidIso(capture.iso)) throw new RangeError('Invalid time');
      fields = buildGateRecordFields(
        capture.iso,
        deviceTimeZone(),
        liteForFields,
        mode === 'scan' ? 'QR' : 'Manual',
        capture.source,
        mode === 'scan' ? scan?.payload : undefined,
      );
    } catch {
      setInlineError(TIME_ERROR);
      return;
    }

    const id = `ge-${Date.now()}`;
    const reference = `GP-${String(Date.now()).slice(-4)}`;
    const assetNumber = lite?.assetNumber ?? machine?.assetNumber ?? data.machineId;
    const make = lite?.make ?? machine?.make;
    const model = lite?.model ?? machine?.model;
    const machineModel = make || model ? `${make ?? ''} ${model ?? ''}`.trim() : '';
    const branchId = machine?.branchId ?? 'branch-dxb';
    const branchName = machine?.branchName ?? machine?.branchId ?? 'Dubai';

    try {
      const gateData = {
        orgId,
        machineId: data.machineId,
        truckPlate: data.truckPlate,
        arrivingFrom: data.arrivingFrom,
        direction,
        assetNumber,
        machineModel,
        branchId,
        branchName,
        gatePass: reference,
        status: 'Pending' as const,
      };

      // The service is the single writer of the gate store, so nothing is stored when it fails.
      await createMutation.mutateAsync({ ...gateData, id, reference, ...fields });
      // STATE MACHINE TRANSITIONS (overview.md Â§4.2)
      if (direction === 'IN') {
        // Machine arriving IN â†’ status â†’ PHI (off-hire, needs inspection)
        setMachineStatus(data.machineId, 'PHI', 'Gate IN â€” off-hire, awaiting PHI inspection');
        toastSuccess('Gate entry IN â€” machine â†’ PHI inspection');
      } else {
        // Machine going OUT â†’ status â†’ On Hire (delivery to customer)
        setMachineStatus(data.machineId, 'On Hire', 'Gate OUT â€” delivered to customer');
        toastSuccess('Gate entry OUT â€” machine â†’ On Hire');
      }
    } catch (err) {
      console.error('Gate entry error:', err);
      toastError('Failed to log gate entry');
      return;
    }

    if (direction === 'IN') {
      try {
        const note = markCollectedForMachine(orgId, data.machineId, {
          id,
          reference,
          timestamp: fields.timestamp,
        });
        if (note) toastSuccess(`Collection Note ${note.number} marked Collected`);
      } catch (err) {
        console.error('Collection note update error:', err);
        toastError('Collection note was not updated');
      }
    }

    form.reset();
    onClose();
  };

  const scannerActive = open && mode === 'scan' && !scan && !scanError && !cameraError;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gate Entry (REF-06)</DialogTitle>
          <DialogDescription>
            Scan QR or enter fleet number Â· Photo of truck Â· Arriving-from Â· Truck plate Â· Submit
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={(e) => {
              if (mode === 'scan' && !scan) {
                e.preventDefault();
                return;
              }
              void form.handleSubmit(onSubmit)(e);
            }}
            className="space-y-4"
          >
            {/* Mode switch â€” always enabled */}
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === 'scan' ? 'default' : 'outline'}
                aria-pressed={mode === 'scan'}
                onClick={() => switchMode('scan')}
              >
                Scan QR
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === 'manual' ? 'default' : 'outline'}
                aria-pressed={mode === 'manual'}
                onClick={() => switchMode('manual')}
              >
                Enter fleet number manually
              </Button>
            </div>

            {mode === 'scan' ? (
              <div className="space-y-2">
                <FormField control={form.control} name="machineId" render={() => (
                  <FormItem>
                    <FormLabel>Fleet Number*</FormLabel>
                    {scannerActive && (
                      <QrScanner
                        key={scanKey}
                        active={scannerActive}
                        onDecode={(t) => { void handleDecode(t); }}
                        onError={(code) => setCameraError(code)}
                      />
                    )}
                    {cameraError && (
                      <div role="alert" className="rounded-md border border-destructive/40 p-2 text-sm text-destructive">
                        {CAMERA_MESSAGES[cameraError]}
                      </div>
                    )}
                    {scanError && (
                      <div role="alert" className="space-y-2 rounded-md border border-destructive/40 p-2 text-sm text-destructive">
                        <p>{scanError.message}</p>
                        <p className="text-xs">Code: {scanError.code}</p>
                        <Button type="button" size="sm" variant="outline" onClick={scanAgain}>Scan again</Button>
                      </div>
                    )}
                    {scan && (
                      <div className="space-y-2 rounded-md border p-2 text-sm" data-testid="scan-result">
                        <p><span className="text-muted-foreground">Fleet No: </span><strong>{fleetNumberOf(scan.machine)}</strong></p>
                        <p>
                          <span className="text-muted-foreground">Make / Model: </span>
                          {scan.machine.make ?? '-'} {scan.machine.model ?? ''}
                        </p>
                        <p>
                          <span className="text-muted-foreground">Gate-In date &amp; time: </span>
                          {scan.gateDate} {scan.gateTime} ({scan.gateTimeZone}){' '}
                          <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                            {scan.capturedAt.source === 'server' ? 'Server time' : 'Device time'}
                          </span>
                        </p>
                        {scan.warnNotOnHire && (
                          <p role="status" className="rounded-md border border-amber-400 bg-amber-50 p-2 text-amber-800">
                            This machine is not On Hire. It will be logged as a Gate-Out.
                          </p>
                        )}
                        <Button type="button" size="sm" variant="outline" onClick={scanAgain}>Scan again</Button>
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            ) : (
              /* Type Fleet Number (REF-06 Â§5.1) */
              <FormField control={form.control} name="machineId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Fleet Number*</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Select fleet number" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {machines && machines.length > 0 ? (
                        machines.map(m => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.assetNumber} â€” {m.make} {m.model}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="__none__" disabled>No machines available</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            )}

            {inlineError && (
              <div role="alert" className="rounded-md border border-destructive/40 p-2 text-sm text-destructive">
                {inlineError}
              </div>
            )}

            {/* Photo of truck/load (REF-06 Â§5.1) */}
            <FormField control={form.control} name="truckPhoto" render={({ field }) => (
              <FormItem>
                <FormLabel>Photo of Truck / Load</FormLabel>
                <FormControl>
                  <Input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(e) => field.onChange(e.target.files?.[0])}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {/* Arriving-from â€” site/yard picklist (REF-06 Â§5.1) */}
            <FormField control={form.control} name="arrivingFrom" render={({ field }) => (
              <FormItem>
                <FormLabel>Arriving From*</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="Yard">Yard</SelectItem>
                    <SelectItem value="Dubai">Dubai</SelectItem>
                    <SelectItem value="Abu Dhabi">Abu Dhabi</SelectItem>
                    <SelectItem value="Taweelah">Taweelah</SelectItem>
                    <SelectItem value="Oilfields">Oilfields</SelectItem>
                    <SelectItem value="Fujairah">Fujairah</SelectItem>
                    <SelectItem value="KSA">KSA</SelectItem>
                    <SelectItem value="External">External</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {/* Truck Plate (REF-06 Â§5.1) */}
            <FormField control={form.control} name="truckPlate" render={({ field }) => (
              <FormItem>
                <FormLabel>Truck Plate*</FormLabel>
                <FormControl><Input placeholder="ABC-1234" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || (mode === 'scan' && !scan)}
                className="w-full"
              >
                {createMutation.isPending ? 'Logging...' : 'Submit â€” Log Gate Entry'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
