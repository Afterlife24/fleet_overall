import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buildQrPayload, fleetNumberOf, type MachineLite } from '@/services/collectionCore';
import { qrDataUrl } from '@/services/collectionPdf';

interface MachineQrPanelProps {
  machine: MachineLite;
  showDownload?: boolean;
}

export function MachineQrPanel({ machine, showDownload = true }: MachineQrPanelProps) {
  const payload = buildQrPayload(machine);
  const fleetNo = fleetNumberOf(machine);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setFailed(false);
    qrDataUrl(payload)
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [payload]);

  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border p-4">
      {dataUrl ? (
        <img src={dataUrl} alt={`QR code for fleet ${fleetNo}`} className="h-40 w-40" />
      ) : (
        <div className="flex h-40 w-40 items-center justify-center text-xs text-muted-foreground">
          {failed ? 'QR unavailable' : 'Generating QR…'}
        </div>
      )}
      <div className="text-sm font-semibold">{fleetNo}</div>
      <code className="break-all text-center text-xs text-muted-foreground">{payload}</code>
      {showDownload && dataUrl && (
        <Button variant="outline" size="sm" asChild>
          <a href={dataUrl} download={`QR-${fleetNo || machine.id}.png`}>
            <Download className="mr-1 h-4 w-4" /> Download PNG
          </a>
        </Button>
      )}
    </div>
  );
}

export default MachineQrPanel;
