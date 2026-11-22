import { useEffect, useState } from 'react';
import { Download, LogIn, LogOut, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/common/StatusBadge';
import { InfoGrid, InfoRow, SectionTitle } from '@/components/common/InfoGrid';
import { cn } from '@/lib/utils';
import { toastError } from '@/lib/toast-helper';
import { JA_ORG_ID, useAuthStore } from '@/store/authStore';
import { dashIfMissing, type GateWhen } from '@/services/gateCore';
import { buildGatePayload } from '@/services/gatePassCore';
import { qrDataUrl } from '@/services/collectionPdf';
import { downloadGateQrPng, printGatePass } from '@/services/gatePassDocs';
import type { GateEntry, GateRecord } from '@/types/gate';

interface GatePassPanelProps {
  entry: GateEntry;
  when: GateWhen;
  /** Existing Process Entry action; the button is shown either way. */
  onProcessEntry?: () => void;
}

const QR_ERROR = 'The QR code could not be generated. The gate pass is saved.';
const PNG_ERROR = 'The QR image could not be downloaded. The gate pass is saved.';
const PDF_ERROR = 'The gate pass PDF could not be created. The gate pass is saved.';

/** Body of the Gate Operations detail slide-over: details, QR, Download PNG, Print Gate Pass, Process Entry. */
export function GatePassPanel({ entry, when, onProcessEntry }: GatePassPanelProps) {
  const authOrg = useAuthStore((s) => s.user?.orgId ?? JA_ORG_ID);
  const rec = entry as GateEntry & Partial<GateRecord>;
  const orgId = rec.orgId ?? authOrg;
  const payload = buildGatePayload({ orgId, id: rec.id, reference: rec.reference });

  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setQrSrc(null);
    setError(null);
    qrDataUrl(payload)
      .then((url) => { if (live) setQrSrc(url); })
      .catch(() => {
        if (!live) return;
        setError(QR_ERROR);
        toastError(QR_ERROR);
      });
    return () => { live = false; };
  }, [payload]);

  const fail = (message: string) => {
    setError(message);
    toastError(message);
  };

  const onDownload = async () => {
    try {
      await downloadGateQrPng({ orgId, id: rec.id, reference: rec.reference });
    } catch {
      fail(PNG_ERROR);
    }
  };

  const onPrint = async () => {
    setBusy(true);
    try {
      await printGatePass(orgId, { ...rec, orgId } as GateRecord);
    } catch {
      fail(PDF_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const fleetNo = rec.fleetNo ?? rec.assetNumber;

  return (
    <div className="space-y-1">
      <div className="mb-4 flex items-center gap-2">
        <StatusBadge status={entry.status} />
        <span className={cn(
          'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium',
          entry.direction === 'IN' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' : 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400',
        )}>
          {entry.direction === 'IN' ? <LogIn className="h-3 w-3" /> : <LogOut className="h-3 w-3" />}
          {entry.direction === 'IN' ? 'Check-in' : 'Check-out'}
        </span>
      </div>

      <SectionTitle>Gate Pass QR</SectionTitle>
      <div className="flex flex-col items-center gap-2 rounded-md border p-3" data-testid="gate-qr">
        {qrSrc ? (
          <img src={qrSrc} alt={`QR code for gate pass ${entry.reference}`} className="h-40 w-40" />
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
      </div>

      <SectionTitle>Gate Entry Details (REF-06)</SectionTitle>
      <InfoGrid columns={2}>
        <InfoRow label="Fleet No." value={fleetNo} />
        <InfoRow label="Truck Plate" value={rec.truckPlate ?? '—'} />
        <InfoRow label="Arriving From" value={rec.arrivingFrom ?? entry.destination} />
        <InfoRow label="Direction" value={entry.direction === 'IN' ? 'IN — Machine arriving' : 'OUT — Machine departing'} />
        <InfoRow label="Gate Pass" value={entry.gatePass} />
        <InfoRow label="Driver" value={entry.driver} />
        <InfoRow label="Branch" value={entry.branchName} />
        <InfoRow label="Gate Date" value={when.available ? when.date : 'Not available'} />
        <InfoRow
          label="Gate Time"
          value={
            when.available
              ? `${when.time} ${when.zone}${entry.timeSource === 'device' ? ' · Device time' : ''}`
              : 'Not available'
          }
        />
        <InfoRow label="Capture Method" value={dashIfMissing(entry.captureMethod)} />
        <InfoRow label="Time Source" value={dashIfMissing(entry.timeSource)} />
        {entry.captureMethod === 'QR' && (
          <InfoRow
            label="QR Payload"
            className="sm:col-span-2"
            value={<span className="break-all">{entry.qrPayload ? entry.qrPayload : 'Not available'}</span>}
          />
        )}
      </InfoGrid>
      {entry.notes && (
        <>
          <SectionTitle>Notes</SectionTitle>
          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{entry.notes}</p>
        </>
      )}

      <div className="pt-4">
        <Button size="sm" className="w-full" onClick={onProcessEntry}>Process Entry</Button>
      </div>
    </div>
  );
}
