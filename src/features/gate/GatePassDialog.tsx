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

// REF-06 §5.1 Gate Capture — ONE page, under 60 seconds, works offline
// Fields: QR scan OR fleet number, photo of truck/load, arriving-from, truck plate, submit
const gatePassSchema = z.object({
  // Scan QR or type fleet number (REF-06 §5.1)
  machineId:     z.string().min(1, 'Fleet number is required'),
  // Photo of truck/load (REF-06 §5.1)
  truckPhoto:    z.instanceof(File).optional(),
  // Arriving-from — site/yard picklist (REF-06 §5.1)
  arrivingFrom:  z.enum(['Yard', 'Dubai', 'Abu Dhabi', 'Taweelah', 'Oilfields', 'Fujairah', 'KSA', 'External']),
  // Truck plate (REF-06 §5.1)
  truckPlate:    z.string().min(2, 'Truck plate is required'),
});

type GatePassFormData = z.infer<typeof gatePassSchema>;

interface GatePassDialogProps {
  open: boolean;
  onClose: () => void;
}

export function GatePassDialog({ open, onClose }: GatePassDialogProps) {
  const { data: machines } = useMachines();
  const createMutation = useCreateGateEntry();
  const { setMachineStatus, getMachineCurrentStatus, addGateEntry } = useAppStore();

  const form = useForm<GatePassFormData>({
    resolver: zodResolver(gatePassSchema),
    defaultValues: {
      arrivingFrom: 'Yard',
    },
  });

  const onSubmit = async (data: GatePassFormData) => {
    try {
      const machine = machines?.find(m => m.id === data.machineId);
      const currentStatus = getMachineCurrentStatus(data.machineId);

      // Determine direction based on current status (overview.md §4.2)
      // If machine is On Hire → coming back IN (off-hire)
      // If machine is Available/PDI/Allocated → going OUT (delivery)
      const direction = currentStatus === 'On Hire' ? 'IN' : 'OUT';

      const gateData = {
        ...data,
        direction,
        machineId: data.machineId,
        assetNumber: machine?.assetNumber ?? data.machineId,
        machineModel: machine ? `${machine.make} ${machine.model}` : '',
        status: 'Pending' as const,
        reference: `GP-${String(Date.now()).slice(-4)}`,
      };

      // Save to appStore
      const now = new Date().toISOString();
      addGateEntry({
        ...gateData,
        id: `ge-${Date.now()}`,
        branchId: machine?.branchId ?? 'branch-dxb',
        branchName: machine?.branchId ?? 'Dubai',
        gatePass: gateData.reference,
        createdAt: now,
        updatedAt: now,
      } as any);

      // Also call service for React Query invalidation
      await createMutation.mutateAsync(gateData);

      // STATE MACHINE TRANSITIONS (overview.md §4.2)
      if (direction === 'IN') {
        // Machine arriving IN → status → PHI (off-hire, needs inspection)
        setMachineStatus(data.machineId, 'PHI', 'Gate IN — off-hire, awaiting PHI inspection');
        toastSuccess('Gate entry IN — machine → PHI inspection');
      } else {
        // Machine going OUT → status → On Hire (delivery to customer)
        setMachineStatus(data.machineId, 'On Hire', 'Gate OUT — delivered to customer');
        toastSuccess('Gate entry OUT — machine → On Hire');
      }

      form.reset();
      onClose();
    } catch (err) {
      console.error('Gate entry error:', err);
      toastError('Failed to log gate entry');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Gate Entry (REF-06)</DialogTitle>
          <DialogDescription>
            Scan QR or enter fleet number · Photo of truck · Arriving-from · Truck plate · Submit
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

            {/* Scan QR or type Fleet Number (REF-06 §5.1) */}
            <FormField control={form.control} name="machineId" render={({ field }) => (
              <FormItem>
                <FormLabel>Fleet Number*</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Scan QR or select fleet number" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {machines?.map(m => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.assetNumber} — {m.make} {m.model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {/* Photo of truck/load (REF-06 §5.1) */}
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

            {/* Arriving-from — site/yard picklist (REF-06 §5.1) */}
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

            {/* Truck Plate (REF-06 §5.1) */}
            <FormField control={form.control} name="truckPlate" render={({ field }) => (
              <FormItem>
                <FormLabel>Truck Plate*</FormLabel>
                <FormControl><Input placeholder="ABC-1234" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending} className="w-full">
                {createMutation.isPending ? 'Logging...' : 'Submit — Log Gate Entry'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
