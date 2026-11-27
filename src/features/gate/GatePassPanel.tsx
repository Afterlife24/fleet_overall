import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Download, FileText, LogIn, LogOut, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/common/StatusBadge';
import { InfoGrid, InfoRow, SectionTitle } from '@/components/common/InfoGrid';
import { ApiErrorNotice } from '@/components/common/ApiStatus';
import { cn } from '@/lib/utils';
import { toastError, toastSuccess } from '@/lib/toast-helper';
import {
  useAttachGatePassPhoto, useCan, usePassBooking, usePassEvidence, useSaveGatePassPdf, useSessionOrgId, useSessionOrgName,
} from '@/hooks/api/useGateApi';
import { dashIfMissing, formatGateWhen, type GateWhen } from '@/services/gateCore';
import { buildGatePayload } from '@/services/gatePassCore';
import { qrDataUrl } from '@/services/collectionPdf';
import { downloadGateQrPng, gatePassContext, printGatePass } from '@/services/gatePassDocs';
import type { GatePassDto } from '@/services/api/gate';
import { PURPOSE_LABEL, gateRecordFromDto } from '@/services/api/gateMappers';

export interface GatePassMachineInfo {
  assetNumber?: string;
  model?: string;
  branchName?: string;
}

interface GatePassPanelProps {
  pass: GatePassDto;
  machine?: GatePassMachineInfo;
  /** Approve, Complete and Cancel buttons owned by the page. */
  actions?: ReactNode;
}

const QR_ERROR = 'The QR code could not be generated. The gate pass is saved on the server.';
const PNG_ERROR = 'The QR image could not be downloaded. The gate pass is saved on the server.';
const PDF_ERROR = 'The gate pass PDF could not be created. The gate pass is saved on the server.';
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Body of the Gate Operations detail slide-over: details, QR, PDF, photos and the page's actions. */
export function GatePassPanel({ pass, machine, actions }: GatePassPanelProps) {
  const orgId = useSessionOrgId();
  const orgName = useSessionOrgName();
  const canWrite = useCan('gate.write');
  const booking = usePassBooking(pass.bookingId);
  const evidence = usePassEvidence(pass.id);
  const attach = useAttachGatePassPhoto();
  const savePdf = useSaveGatePassPdf();

  const record = useMemo(
    () => gateRecordFromDto(pass, {
      orgId,
      assetNumber: machine?.assetNumber,
      machineModel: machine?.model,
      branchName: machine?.branchName,
      customer: booking.data?.customerName,
      timeZone: deviceZone(),
    }),
    [pass, orgId, machine?.assetNumber, machine?.model, machine?.branchName, booking.data?.customerName],
  );
  const ctx = useMemo(
    () => gatePassContext(orgName, { hireAgreementNo: booking.data?.agreementNo ?? undefined }),
    [orgName, booking.data?.agreementNo],
  );
  const payload = buildGatePayload({ orgId, id: pass.id, reference: pass.reference });

  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setQrSrc(null);
    setError(null);
    if (!orgId) return undefined;
    qrDataUrl(payload)
      .then((url) => { if (live) setQrSrc(url); })
      .catch(() => {
        if (!live) return;
        setError(QR_ERROR);
        toastError(QR_ERROR);
      });
    return () => { live = false; };
  }, [payload, orgId]);

  const fail = (message: string) => {
    setError(message);
    toastError(message);
  };

  const onDownload = async () => {
    try {
      await downloadGateQrPng({ orgId, id: pass.id, reference: pass.reference });
    } catch {
      fail(PNG_ERROR);
    }
  };

  const onPrint = async () => {
    setBusy(true);
    try {
      await printGatePass(record, ctx);
    } catch {
      fail(PDF_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const onSavePdf = () => {
    savePdf.mutate({ pass, record, ctx }, {
      onSuccess: (doc) => toastSuccess(`Gate pass PDF stored as ${doc.documentNo}`),
    });
  };

  const onPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    attach.mutate({ passId: pass.id, file, photoRole: 'TRUCK' }, { onSuccess: () => toastSuccess('Photo attached') });
  };

  const crossed: GateWhen = pass.movement
    ? formatGateWhen({ timestamp: pass.movement.occurredAt, gateTimeZone: deviceZone() })
    : { available: false };
  const fleetNo = pass.fleetNoSnapshot;
  const reopenNote = pass.status === 'Pending' || pass.status === 'Approved';

  return (
    <div className="space-y-1">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={pass.status} />
        <span className={cn(
          'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium',
          pass.direction === 'IN' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' : 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400',
        )}>
          {pass.direction === 'IN' ? <LogIn className="h-3 w-3" /> : <LogOut className="h-3 w-3" />}
          {pass.direction === 'IN' ? 'Check-in' : 'Check-out'}
        </span>
        <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{PURPOSE_LABEL[pass.movementPurpose]}</span>
      </div>

      {reopenNote && (
        <p role="status" className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
          This pass has not crossed the gate. The machine, booking and collection note change only when the pass is completed.
        </p>
      )}

      {actions && <div className="mb-3 flex flex-wrap gap-2">{actions}</div>}

      <SectionTitle>Gate Pass QR</SectionTitle>
      <div className="flex flex-col items-center gap-2 rounded-md border p-3" data-testid="gate-qr">
        {qrSrc ? (
          <img src={qrSrc} alt={`QR code for gate pass ${pass.reference}`} className="h-40 w-40" />
        ) : (
          <div className="flex h-40 w-40 items-center justify-center text-xs text-muted-foreground">
            {error ? 'QR unavailable' : 'Generating QR...'}
          </div>
        )}
        <p className="text-sm font-semibold" data-testid="gate-qr-fleet">{fleetNo}</p>
        <p className="break-all text-center text-xs text-muted-foreground" data-testid="gate-qr-payload">{payload}</p>
        {error && (
          <div role="alert" className="w-full rounded-md border border-destructive/40 p-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="flex w-full gap-2">
          <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => { void onDownload(); }}>
            <Download className="mr-1.5 h-4 w-4" /> Download PNG
          </Button>
          <Button type="button" variant="outline" size="sm" className="flex-1" disabled={busy} onClick={() => { void onPrint(); }}>
            <Printer className="mr-1.5 h-4 w-4" /> Print Gate Pass
          </Button>
        </div>
        {canWrite && (
          <Button type="button" variant="outline" size="sm" className="w-full" disabled={savePdf.isPending} onClick={onSavePdf}>
            <FileText className="mr-1.5 h-4 w-4" /> {savePdf.isPending ? 'Saving PDF...' : 'Save PDF to documents'}
          </Button>
        )}
        {savePdf.isError && <ApiErrorNotice error={savePdf.error} className="w-full" />}
      </div>

      <SectionTitle>Gate Entry Details (REF-06)</SectionTitle>
      <InfoGrid columns={2}>
        <InfoRow label="Fleet No." value={fleetNo} />
        <InfoRow label="Machine" value={machine?.model || '—'} />
        <InfoRow label="Truck Plate" value={pass.truckPlate ?? '—'} />
        <InfoRow label="Arriving From" value={pass.arrivingFrom ?? '—'} />
        <InfoRow label="Destination" value={pass.destination} />
        <InfoRow label="Direction" value={pass.direction === 'IN' ? 'IN — Machine arriving' : 'OUT — Machine departing'} />
        <InfoRow label="Gate Pass" value={pass.reference} />
        <InfoRow label="Driver" value={pass.driverName} />
        <InfoRow label="Branch" value={machine?.branchName || '—'} />
        <InfoRow label="Booking" value={booking.data ? `${booking.data.reference} · ${booking.data.customerName}` : pass.bookingId ? 'Loading...' : '—'} />
        <InfoRow label="Requested" value={new Date(pass.requestedAt).toLocaleString()} />
        <InfoRow label="Approved" value={pass.approvedAt ? new Date(pass.approvedAt).toLocaleString() : 'Not approved'} />
        <InfoRow label="Gate Date" value={crossed.available ? crossed.date : 'Not crossed yet'} />
        <InfoRow
          label="Gate Time"
          value={crossed.available ? `${crossed.time} ${crossed.zone}${pass.movement?.timeSource === 'DATABASE' ? ' · Server time' : ''}` : 'Not crossed yet'}
        />
        <InfoRow label="Capture Method" value={dashIfMissing(pass.captureMethod)} />
        {pass.captureMethod === 'QR' && (
          <InfoRow
            label="QR Payload"
            className="sm:col-span-2"
            value={<span className="break-all">{pass.qrPayload ?? 'Not available'}</span>}
          />
        )}
      </InfoGrid>
      {pass.notes && (
        <>
          <SectionTitle>Notes</SectionTitle>
          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{pass.notes}</p>
        </>
      )}

      <SectionTitle>Photos</SectionTitle>
      <div className="space-y-2">
        {(evidence.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No photos attached.</p>
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {(evidence.data ?? []).map((e) => <li key={e.id}>{e.originalName} <span className="text-xs text-muted-foreground">({e.photoRole})</span></li>)}
          </ul>
        )}
        {canWrite && (
          <Input type="file" accept="image/png,image/jpeg" capture="environment" disabled={attach.isPending} onChange={onPhoto} aria-label="Attach photo" />
        )}
        {attach.isPending && <p className="text-xs text-muted-foreground">Uploading and checking the photo...</p>}
        {attach.isError && <ApiErrorNotice error={attach.error} />}
      </div>
    </div>
  );
}
