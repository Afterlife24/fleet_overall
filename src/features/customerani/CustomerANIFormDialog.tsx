import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useCreateCustomerANI, useUpdateCustomerANI } from '@/hooks/useQueries';
import type { CustomerANI } from '@/types/customerani';
import { toastSuccess, toastError } from '@/lib/toast-helper';
import { cn } from '@/lib/utils';

interface FormValues {
  customerName: string;
  customerId: string;
  trn: string;
  address: string;
  attl: number;
  contactNumber: string;
  branchName: string;
  status: 'Active' | 'Inactive' | 'Suspended';
  aniRavaliActive: boolean;
  notes: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  editRecord?: CustomerANI;
}

export function CustomerANIFormDialog({ open, onClose, editRecord }: Props) {
  const isEdit = !!editRecord;
  const createMutation = useCreateCustomerANI();
  const updateMutation = useUpdateCustomerANI();

  const {
    register, handleSubmit, reset, formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      customerName: '',
      customerId: '',
      trn: '',
      address: '',
      attl: 0,
      contactNumber: '',
      branchName: 'Head Office',
      status: 'Active',
      aniRavaliActive: false,
      notes: '',
    },
  });

  // Populate form when editing
  useEffect(() => {
    if (open && editRecord) {
      reset({
        customerName: editRecord.customerName,
        customerId: editRecord.customerId,
        trn: editRecord.trn,
        address: editRecord.address,
        attl: editRecord.attl,
        contactNumber: editRecord.contactNumber,
        branchName: editRecord.branchName,
        status: editRecord.status,
        aniRavaliActive: editRecord.aniRavaliActive,
        notes: editRecord.notes ?? '',
      });
    } else if (open && !editRecord) {
      reset({
        customerName: '', customerId: '', trn: '', address: '',
        attl: 0, contactNumber: '', branchName: 'Head Office',
        status: 'Active', aniRavaliActive: false, notes: '',
      });
    }
  }, [open, editRecord, reset]);

  const onSubmit = async (values: FormValues) => {
    try {
      if (isEdit && editRecord) {
        await updateMutation.mutateAsync({ id: editRecord.id, data: values });
        toastSuccess('Customer ANI record updated');
      } else {
        await createMutation.mutateAsync(values);
        toastSuccess('Customer ANI record created');
      }
      onClose();
    } catch {
      toastError('Could not save record. Please try again.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Customer ANI' : 'New Customer ANI'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

            {/* Customer Name */}
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="customerName">Customer Name <span className="text-rose-500">*</span></Label>
              <Input
                id="customerName"
                {...register('customerName', { required: 'Customer name is required' })}
                placeholder="e.g. Al Futtaim Engineering"
                className={cn(errors.customerName && 'border-rose-400')}
              />
              {errors.customerName && <p className="text-xs text-rose-500">{errors.customerName.message}</p>}
            </div>

            {/* Customer ID */}
            <div className="space-y-1.5">
              <Label htmlFor="customerId">Customer ID</Label>
              <Input
                id="customerId"
                {...register('customerId')}
                placeholder="e.g. AFE-1042"
              />
            </div>

            {/* TRN */}
            <div className="space-y-1.5">
              <Label htmlFor="trn">TRN (Tax Reg. No.) <span className="text-rose-500">*</span></Label>
              <Input
                id="trn"
                {...register('trn', { required: 'TRN is required' })}
                placeholder="e.g. 100412345600003"
                className={cn(errors.trn && 'border-rose-400')}
              />
              {errors.trn && <p className="text-xs text-rose-500">{errors.trn.message}</p>}
            </div>

            {/* Contact Number */}
            <div className="space-y-1.5">
              <Label htmlFor="contactNumber">Contact Number</Label>
              <Input
                id="contactNumber"
                {...register('contactNumber')}
                placeholder="+971 50 1234567"
              />
            </div>

            {/* ATTL */}
            <div className="space-y-1.5">
              <Label htmlFor="attl">ATTL (Credit Limit AED)</Label>
              <Input
                id="attl"
                type="number"
                min={0}
                step={1000}
                {...register('attl', { valueAsNumber: true })}
                placeholder="500000"
              />
            </div>

            {/* Branch */}
            <div className="space-y-1.5">
              <Label htmlFor="branchName">Branch</Label>
              <Input
                id="branchName"
                {...register('branchName')}
                placeholder="Dubai HQ"
              />
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <select
                id="status"
                {...register('status')}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
                <option value="Suspended">Suspended</option>
              </select>
            </div>

            {/* ANI Ravali */}
            <div className="space-y-1.5">
              <Label htmlFor="aniRavaliActive">ANI Ravali Activation</Label>
              <select
                id="aniRavaliActive"
                {...register('aniRavaliActive', { setValueAs: (v) => v === 'true' || v === true })}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="false">Inactive</option>
                <option value="true">Active</option>
              </select>
            </div>

            {/* Address */}
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                {...register('address')}
                placeholder="e.g. 42 Sheikh Zayed Rd, Dubai, UAE"
              />
            </div>

            {/* Notes */}
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <textarea
                id="notes"
                {...register('notes')}
                rows={3}
                placeholder="Optional notes…"
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Customer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
