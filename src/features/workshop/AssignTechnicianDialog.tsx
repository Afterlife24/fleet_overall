import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAssignTechnician, useTechnicians } from '@/hooks/useQueries';
import { toastSuccess, toastError } from '@/lib/toast-helper';
import { WorkshopJob } from '@/types';

const assignSchema = z.object({
  technicianId: z.string().min(1, 'Technician is required'),
  bayId: z.string().optional(),
});

type AssignFormData = z.infer<typeof assignSchema>;

interface AssignTechnicianDialogProps {
  open: boolean;
  onClose: () => void;
  job: WorkshopJob | null;
}

export function AssignTechnicianDialog({ open, onClose, job }: AssignTechnicianDialogProps) {
  const { data: technicians } = useTechnicians();
  const assignMutation = useAssignTechnician();

  const form = useForm<AssignFormData>({
    resolver: zodResolver(assignSchema),
    defaultValues: {
      technicianId: (job as any)?.assignedTo || (job as any)?.technicianId || '',
      bayId: (job as any)?.bayId || '',
    },
  });

  const onSubmit = async (data: AssignFormData) => {
    if (!job) return;
    try {
      await assignMutation.mutateAsync({ 
        jobId: job.id, 
        technicianId: data.technicianId,
        ...(data.bayId && { bayId: data.bayId })
      } as any);
      toastSuccess('Technician assigned successfully');
      form.reset();
      onClose();
    } catch (error) {
      toastError('Failed to assign technician');
    }
  };

  const bays = ['Bay 1', 'Bay 2', 'Bay 3', 'Bay 4', 'Bay 5', 'Bay 6'];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Technician</DialogTitle>
          <DialogDescription>
            Assign or reassign technician for {(job as any)?.jobNumber || job?.reference || 'this job'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="technicianId" render={({ field }) => (
              <FormItem>
                <FormLabel>Technician</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select technician" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {technicians?.map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="bayId" render={({ field }) => (
              <FormItem>
                <FormLabel>Bay (Optional)</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select bay" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {bays.map(bay => (
                      <SelectItem key={bay} value={bay}>{bay}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={assignMutation.isPending}>
                {assignMutation.isPending ? 'Assigning...' : 'Assign'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
