import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fleetNumberOf } from '@/services/collectionCore';
import {
  initiateOffHire,
  listPickerMachines,
  type InitiateResult,
  type MachineResolver,
  type TransportJobCallback,
} from '@/services/collectionDocs';

interface InitiateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  machines: MachineResolver;
  createTransportJob?: TransportJobCallback;
  preselectMachineId?: string;
  onCreated?: (result: InitiateResult) => void;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export function InitiateDialog({
  open,
  onOpenChange,
  machines,
  createTransportJob,
  preselectMachineId,
  onCreated,
}: InitiateDialogProps) {
  const [machineId, setMachineId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [result, setResult] = useState<InitiateResult | null>(null);

  // Recomputed each time the dialog opens so status changes are reflected.
  const eligible = useMemo(() => (open ? listPickerMachines(machines) : []), [open, machines]);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setDate(todayIso());
    setMachineId(preselectMachineId ?? '');
  }, [open, preselectMachineId]);

  const selectedValid = eligible.some((m) => m.id === machineId);
  const canSubmit = selectedValid && date !== '' && !result?.ok;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const r = initiateOffHire({ machineId, date, machines, createTransportJob });
    setResult(r);
    if (r.ok) onCreated?.(r);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Initiate Off-Hire / Collection</DialogTitle>
          <DialogDescription>Creates the collection note and linked documents for a machine on hire.</DialogDescription>
        </DialogHeader>

        {eligible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No machines are currently On Hire, so there is nothing to collect.</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="initiate-machine">Machine</Label>
              <Select value={machineId} onValueChange={setMachineId} disabled={!!result?.ok}>
                <SelectTrigger id="initiate-machine">
                  <SelectValue placeholder="Select a machine" />
                </SelectTrigger>
                <SelectContent>
                  {eligible.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {fleetNumberOf(m)}
                      {m.make || m.model ? ` – ${[m.make, m.model].filter(Boolean).join(' ')}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="initiate-date">Collection date</Label>
              <Input
                id="initiate-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={!!result?.ok}
              />
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-2 text-sm">
            {result.ok && (
              <ul className="list-disc pl-5">
                {result.cn && <li>Collection Note: {result.cn.number}</li>}
                {result.mqd && <li>MQD: {result.mqd.number}</li>}
                {result.tps && <li>Third-Party Services: {result.tps.number}</li>}
              </ul>
            )}
            {result.notices.map((n, i) => (
              <p
                key={i}
                role={n.level === 'error' ? 'alert' : undefined}
                className={n.level === 'error' ? 'text-destructive' : 'text-muted-foreground'}
              >
                {n.message}
              </p>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {result?.ok ? 'Close' : 'Cancel'}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            Initiate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default InitiateDialog;
