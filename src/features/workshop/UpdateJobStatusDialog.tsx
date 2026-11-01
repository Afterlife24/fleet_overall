import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateWorkshopJobStatus } from '@/hooks/useQueries';
import { toastSuccess, toastError } from '@/lib/toast-helper';
import { WorkshopJob } from '@/types';

const statusSchema = z.object({
  status: z.string().min(1, 'Status is required'),
  notes: z.string().optional(),
});

type StatusFormData = z.infer<typeof statusSchema>;

interface UpdateJobStatusDialogProps {
  open: boolean;
  onClose: () => void;
  job: WorkshopJob | null;
}

export function UpdateJobStatusDialog({ open, onClose, job }: UpdateJobStatusDialogProps) {
  const updateMutation = useUpdateWorkshopJobStatus();

  const form = useForm<StatusFormData>({
    resolver: zodResolver(statusSchema),
    defaultValues: {
      status: job?.status || '',
      notes: '',
    },
  });

  const onSubmit = async (data: StatusFormData) => {
    if (!job) return;
    try {
      await updateMutation.mutateAsync({ id: job.id, status: data.status, ...(data.notes && { notes: data.notes }) } as any);
      toastSuccess('Job status updated successfully');
      form.reset();
      onClose();
    } catch (error) {
      toastError('Failed to update job status');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Update Job Status</DialogTitle>
          <DialogDescription>
            Update status for {(job as any)?.jobNumber || job?.reference || 'this job'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="status" render={({ field }) => (
              <FormItem>
                <FormLabel>New Status</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {['Pending', 'In Progress', 'On Hold', 'Completed', 'Quality Check'].map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes (Optional)</FormLabel>
                <FormControl>
                  <Textarea placeholder="Add any notes about this status change..." rows={3} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? 'Updating...' : 'Update Status'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
