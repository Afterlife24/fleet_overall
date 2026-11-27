import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ApiErrorNotice, describeApiError } from '@/components/common/ApiStatus';
import {
  attachEvidencePhoto, useCan, useCreateGatePass, useMachineBookings, useResolveQr, useSubmission,
} from '@/hooks/api/useGateApi';
import { useFleetMachines } from '@/hooks/useApiResources';
import { toastError, toastSuccess, toastWarning } from '@/lib/toast-helper';
import type { BookingDto } from '@/services/api/bookings';
import type { GateDirection, GatePassCreateDto, GatePassDto, GatePurpose, ResolveQrDto } from '@/services/api/gate';
import { PURPOSE_LABEL } from '@/services/api/gateMappers';
import { CAMERA_MESSAGES, type CameraErrorCode } from '@/services/gateCore';
import { QrScanner } from './QrScanner';

// REF-06 §5.1 Gate Capture. A scan is resolved by the server (strict); the pass is created Pending and has no
// physical effect until it is completed. Manual entry is the authorized fallback and is recorded as Manual.

type Mode = 'scan' | 'manual';

const ARRIVING_FROM = ['Yard', 'Dubai', 'Abu Dhabi', 'Taweelah', 'Oilfields', 'Fujairah', 'KSA', 'External'] as const;
const PURPOSES: GatePurpose[] = ['CUSTOMER_HIRE', 'CUSTOMER_RETURN', 'TRANSFER'];

export const QR_INVALID_MESSAGE = 'This QR code is not valid. No gate pass was created and no movement was recorded.';

/** Direction follows the purpose; only a transfer lets the operator choose. */
export function directionForPurpose(purpose: GatePurpose, chosen: GateDirection | ''): GateDirection | '' {
  if (purpose === 'CUSTOMER_HIRE') return 'OUT';
  if (purpose === 'CUSTOMER_RETURN') return 'IN';
  return chosen;
}

/** Bookings a customer movement may reference: out on hire for a return, not yet dispatched for a hire. */
export function eligibleBookings(purpose: GatePurpose | '', bookings: readonly BookingDto[]): BookingDto[] {
  if (purpose === 'CUSTOMER_RETURN') return bookings.filter((b) => b.status === 'On Hire' && !!b.departedAt && !b.returnedAt);
  if (purpose === 'CUSTOMER_HIRE') return bookings.filter((b) => !['Cancelled', 'Returned', 'Draft'].includes(b.status) && !b.departedAt);
  return [];
}

interface GatePassDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenPass?: (id: string) => void;
}

export function GatePassDialog({ open, onClose, onOpenPass }: GatePassDialogProps) {
  const canWrite = useCan('gate.write');
  const machinesQuery = useFleetMachines();
  const resolveQr = useResolveQr();
  const createPass = useCreateGatePass();
  const submission = useSubmission();
  const lastBody = useRef('');

  const [mode, setMode] = useState<Mode>('scan');
  const [scan, setScan] = useState<{ result: ResolveQrDto; payload: string; scannedAt: string } | null>(null);
  const [scanError, setScanError] = useState<unknown>(null);
  const [cameraError, setCameraError] = useState<CameraErrorCode | null>(null);
  const [scanKey, setScanKey] = useState(0);
  const scanToken = useRef(0);

  const [manualMachineId, setManualMachineId] = useState('');
  const [purpose, setPurpose] = useState<GatePurpose | ''>('');
  const [transferDirection, setTransferDirection] = useState<GateDirection | ''>('');
  const [bookingId, setBookingId] = useState('');
  const [driverName, setDriverName] = useState('');
  const [truckPlate, setTruckPlate] = useState('');
  const [arrivingFrom, setArrivingFrom] = useState<string>('Yard');
  const [destination, setDestination] = useState('');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);

  const machineId = mode === 'scan' ? (scan?.result.kind === 'FLEET' ? scan.result.machine.id : '') : manualMachineId;
  const bookingsQuery = useMachineBookings(purpose === 'TRANSFER' || !purpose ? null : machineId || null);
  const bookings = useMemo(() => eligibleBookings(purpose, bookingsQuery.data ?? []), [purpose, bookingsQuery.data]);
  const direction = purpose ? directionForPurpose(purpose, transferDirection) : '';
  const customerMovement = purpose === 'CUSTOMER_HIRE' || purpose === 'CUSTOMER_RETURN';
  const candidate = scan?.result.candidateBooking ?? null;
  const candidateNote = scan?.result.candidateCollectionNote ?? null;

  const resetForm = useCallback(() => {
    setPurpose('');
    setTransferDirection('');
    setBookingId('');
    setDriverName('');
    setTruckPlate('');
    setArrivingFrom('Yard');
    setDestination('');
    setNotes('');
    setPhoto(null);
    setSubmitError(null);
  }, []);

  const clearScanState = useCallback(() => {
    scanToken.current += 1;
    setScan(null);
    setScanError(null);
    setCameraError(null);
    setManualMachineId('');
    resolveQr.reset();
    resetForm();
    submission.renew();
    lastBody.current = '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetForm]);

  // Opening always starts in Scan mode with no scan data.
  useEffect(() => {
    if (!open) return;
    setMode('scan');
    clearScanState();
    setScanKey((k) => k + 1);
  }, [open, clearScanState]);

  // A fleet scan with a single return candidate pre-selects the booking for a customer return.
  useEffect(() => {
    if (purpose === 'CUSTOMER_RETURN' && candidate && !bookingId) setBookingId(candidate.id);
  }, [purpose, candidate, bookingId]);

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

  const changePurpose = (value: string) => {
    const next = value as GatePurpose;
    setPurpose(next);
    setBookingId(next === 'CUSTOMER_RETURN' && candidate ? candidate.id : '');
    if (next === 'TRANSFER') setTransferDirection('');
    if (directionForPurpose(next, '') === 'IN' && !destination.trim()) setDestination('Yard');
    setSubmitError(null);
  };

  const handleDecode = async (text: string) => {
    const token = ++scanToken.current;
    try {
      const result = await resolveQr.mutateAsync(text);
      if (token !== scanToken.current) return;
      setScan({ result, payload: text, scannedAt: new Date().toISOString() });
      setScanError(null);
    } catch (err) {
      if (token !== scanToken.current) return;
      setScanError(err);
    }
  };

  const qrInvalid = scanError ? describeApiError(scanError).code === 'QR_INVALID' : false;
  const scanResultIsPass = scan?.result.kind === 'GATE_PASS';

  const bodyReady = useMemo(() => {
    if (!machineId || !purpose || !direction) return false;
    if (customerMovement && !bookingId) return false;
    if (!driverName.trim() || !destination.trim()) return false;
    if (mode === 'scan' && (!scan || scan.result.kind !== 'FLEET')) return false;
    return true;
  }, [machineId, purpose, direction, customerMovement, bookingId, driverName, destination, mode, scan]);

  const onSubmit = async () => {
    if (!bodyReady || !purpose || !direction) return;
    setSubmitError(null);
    const noteId = purpose === 'CUSTOMER_RETURN' && candidateNote && candidate && bookingId === candidate.id ? candidateNote.id : null;
    const body: GatePassCreateDto = {
      direction,
      movementPurpose: purpose,
      machineId,
      bookingId: customerMovement ? bookingId : null,
      collectionNoteId: noteId,
      captureMethod: mode === 'scan' ? 'QR' : 'Manual',
      ...(mode === 'scan' && scan ? { qrPayload: scan.payload, scannedAt: scan.scannedAt, deviceCapturedAt: scan.scannedAt } : {}),
      driverName: driverName.trim(),
      truckPlate: truckPlate.trim() || null,
      destination: destination.trim(),
      arrivingFrom: direction === 'IN' ? arrivingFrom : null,
      notes: notes.trim() || null,
    };
    // One Idempotency-Key per submission: a retry of the same body reuses it, an edited body gets a new one.
    const signature = JSON.stringify(body);
    if (signature !== lastBody.current) submission.renew();
    lastBody.current = signature;

    let pass: GatePassDto;
    try {
      pass = await createPass.mutateAsync({ body, submissionId: submission.id() });
    } catch (err) {
      setSubmitError(err);
      return;
    }
    submission.renew();
    lastBody.current = '';
    toastSuccess(`Gate pass ${pass.reference} created (Pending). The machine has not moved yet.`);

    if (photo) {
      try {
        await attachEvidencePhoto(photo, { gatePassId: pass.id }, 'TRUCK');
      } catch (err) {
        toastWarning(`Gate pass saved, but the photo was not attached: ${err instanceof Error ? err.message : 'upload failed'}`);
      }
    }
    onOpenPass?.(pass.id);
    onClose();
  };

  const scannerActive = open && mode === 'scan' && !scan && !scanError && !cameraError && !resolveQr.isPending;
  const machines = machinesQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gate Entry (REF-06)</DialogTitle>
          <DialogDescription>
            Scan the fleet QR, choose what the movement is, pick the booking, then create the pass. The pass is Pending until it is approved and completed at the gate.
          </DialogDescription>
        </DialogHeader>

        {!canWrite && (
          <div role="alert" className="rounded-md border border-destructive/40 p-2 text-sm text-destructive">
            Your role cannot create gate passes.
          </div>
        )}

        <div className="space-y-4">
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={mode === 'scan' ? 'default' : 'outline'} aria-pressed={mode === 'scan'} onClick={() => switchMode('scan')}>
              Scan QR
            </Button>
            <Button type="button" size="sm" variant={mode === 'manual' ? 'default' : 'outline'} aria-pressed={mode === 'manual'} onClick={() => switchMode('manual')} disabled={!canWrite}>
              Enter fleet number manually
            </Button>
          </div>

          {mode === 'scan' ? (
            <div className="space-y-2">
              <Label>Fleet QR*</Label>
              {scannerActive && (
                <QrScanner key={scanKey} active={scannerActive} onDecode={(t) => { void handleDecode(t); }} onError={(code) => setCameraError(code)} />
              )}
              {resolveQr.isPending && <p className="text-sm text-muted-foreground" role="status">Checking the QR code...</p>}
              {cameraError && (
                <div role="alert" className="rounded-md border border-destructive/40 p-2 text-sm text-destructive">
                  {CAMERA_MESSAGES[cameraError]}
                </div>
              )}
              {scanError != null && qrInvalid && (
                <div role="alert" data-testid="qr-invalid" className="space-y-2 rounded-md border border-destructive/40 p-2 text-sm text-destructive">
                  <p className="font-medium">{QR_INVALID_MESSAGE}</p>
                  <p className="text-xs">{describeApiError(scanError).message}</p>
                  <p className="text-xs">Code: QR_INVALID</p>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={scanAgain}>Scan again</Button>
                    {canWrite && <Button type="button" size="sm" variant="outline" onClick={() => switchMode('manual')}>Use manual entry</Button>}
                  </div>
                </div>
              )}
              {scanError != null && !qrInvalid && (
                <div className="space-y-2">
                  <ApiErrorNotice error={scanError} />
                  <Button type="button" size="sm" variant="outline" onClick={scanAgain}>Scan again</Button>
                </div>
              )}
              {scan && scanResultIsPass && (
                <div className="space-y-2 rounded-md border p-2 text-sm" data-testid="scan-result">
                  <p>This is the QR of gate pass <strong>{scan.result.pass?.reference}</strong> ({scan.result.pass?.status}). No new pass is created.</p>
                  <div className="flex gap-2">
                    {scan.result.pass && onOpenPass && (
                      <Button type="button" size="sm" onClick={() => { onOpenPass(scan.result.pass!.id); onClose(); }}>Open pass</Button>
                    )}
                    <Button type="button" size="sm" variant="outline" onClick={scanAgain}>Scan again</Button>
                  </div>
                </div>
              )}
              {scan && !scanResultIsPass && (
                <div className="space-y-2 rounded-md border p-2 text-sm" data-testid="scan-result">
                  <p><span className="text-muted-foreground">Fleet No: </span><strong>{scan.result.machine.fleetNo}</strong></p>
                  <p><span className="text-muted-foreground">Asset No: </span>{scan.result.machine.assetNo}</p>
                  <p><span className="text-muted-foreground">Status: </span>{scan.result.machine.operationalStatus} · {scan.result.machine.readinessStatus}</p>
                  <p><span className="text-muted-foreground">Location: </span>{scan.result.machine.currentLocation || '—'}</p>
                  {scan.result.openPasses.length > 0 && (
                    <p role="status" className="rounded-md border border-amber-400 bg-amber-50 p-2 text-amber-800">
                      This machine already has an open pass: {scan.result.openPasses.map((p) => `${p.reference} (${p.status})`).join(', ')}.
                    </p>
                  )}
                  {scan.result.manualSelectionRequired ? (
                    <p role="status" className="rounded-md border border-amber-400 bg-amber-50 p-2 text-amber-800">
                      No single return booking was found for this machine. Choose the booking yourself below.
                    </p>
                  ) : candidate ? (
                    <p className="text-xs text-muted-foreground">Return candidate: {candidate.reference}{candidateNote ? ` · collection note ${candidateNote.number}` : ''}</p>
                  ) : null}
                  <Button type="button" size="sm" variant="outline" onClick={scanAgain}>Scan again</Button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Fleet Number*</Label>
              <Select value={manualMachineId} onValueChange={(v) => { setManualMachineId(v); setBookingId(''); }}>
                <SelectTrigger aria-label="Fleet number"><SelectValue placeholder="Select fleet number" /></SelectTrigger>
                <SelectContent>
                  {machines.length > 0 ? machines.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.fleetNo ?? m.assetNumber} — {m.make} {m.model}</SelectItem>
                  )) : (
                    <SelectItem value="__none__" disabled>{machinesQuery.isLoading ? 'Loading machines...' : 'No machines available'}</SelectItem>
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Manual entry is recorded as a Manual capture, not a QR scan.</p>
            </div>
          )}

          {machineId && !scanResultIsPass && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Movement purpose*</Label>
                <Select value={purpose} onValueChange={changePurpose}>
                  <SelectTrigger aria-label="Movement purpose"><SelectValue placeholder="Choose the purpose" /></SelectTrigger>
                  <SelectContent>
                    {PURPOSES.map((p) => <SelectItem key={p} value={p}>{PURPOSE_LABEL[p]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {purpose === 'TRANSFER' && (
                <div className="space-y-1">
                  <Label>Direction*</Label>
                  <Select value={transferDirection} onValueChange={(v) => setTransferDirection(v as GateDirection)}>
                    <SelectTrigger aria-label="Direction"><SelectValue placeholder="IN or OUT" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="IN">IN — machine arriving</SelectItem>
                      <SelectItem value="OUT">OUT — machine departing</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {purpose && purpose !== 'TRANSFER' && (
                <p className="text-xs text-muted-foreground">Direction: <strong>{direction}</strong></p>
              )}

              {customerMovement && (
                <div className="space-y-1">
                  <Label>Booking*</Label>
                  <Select value={bookingId} onValueChange={setBookingId}>
                    <SelectTrigger aria-label="Booking"><SelectValue placeholder={bookingsQuery.isLoading ? 'Loading bookings...' : 'Select the exact booking'} /></SelectTrigger>
                    <SelectContent>
                      {bookings.length > 0 ? bookings.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.reference} — {b.customerName} ({b.startDate} to {b.endDate})</SelectItem>
                      )) : (
                        <SelectItem value="__none__" disabled>No matching booking for this machine</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  {bookingsQuery.isError && <ApiErrorNotice error={bookingsQuery.error} onRetry={() => void bookingsQuery.refetch()} />}
                </div>
              )}

              <div className="space-y-1">
                <Label htmlFor="gate-driver">Driver*</Label>
                <Input id="gate-driver" value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="Driver name" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="gate-plate">Truck Plate</Label>
                <Input id="gate-plate" value={truckPlate} onChange={(e) => setTruckPlate(e.target.value)} placeholder="ABC-1234" />
              </div>
              {direction === 'IN' && (
                <div className="space-y-1">
                  <Label>Arriving From*</Label>
                  <Select value={arrivingFrom} onValueChange={setArrivingFrom}>
                    <SelectTrigger aria-label="Arriving from"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ARRIVING_FROM.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="gate-destination">{direction === 'OUT' ? 'Destination*' : 'Destination / yard*'}</Label>
                <Input id="gate-destination" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder={direction === 'OUT' ? 'Customer site' : 'Yard'} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="gate-photo">Photo of Truck / Load</Label>
                <Input id="gate-photo" type="file" accept="image/png,image/jpeg" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="gate-notes">Notes</Label>
                <Textarea id="gate-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
            </div>
          )}

          {submitError != null && <ApiErrorNotice error={submitError} />}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            disabled={createPass.isPending || !bodyReady || !canWrite}
            className="w-full"
            onClick={() => { void onSubmit().catch((e) => toastError(e instanceof Error ? e.message : 'Failed to create the gate pass')); }}
          >
            {createPass.isPending ? 'Creating...' : 'Create Gate Pass'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
