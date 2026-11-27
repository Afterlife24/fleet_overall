import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { ApiErrorNotice, describeApiError } from '@/components/common/ApiStatus';
import {
  fetchCustomer, useApiBranches, useCreateCustomer, useSubmission, useUpdateCustomer,
} from '@/hooks/useApiResources';
import { customerStatusToApi } from '@/services/api/mappers';
import type { CustomerANI } from '@/types/customerani';
import { toastSuccess } from '@/lib/toast-helper';
import { cn } from '@/lib/utils';

interface FormValues {
  customerName: string;
  customerId: string;
  trn: string;
  attn: string;
  email: string;
  address: string;
  billingAddress: string;
  attl: number;
  contactNumber: string;
  branchId: string;
  status: 'Active' | 'Inactive' | 'Suspended' | 'Blacklisted';
  aniRavaliActive: boolean;
  notes: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  editRecord?: CustomerANI;
}

const EMPTY: FormValues = {
  customerName: '', customerId: '', trn: '', attn: '', email: '',
  address: '', billingAddress: '', attl: 0, contactNumber: '',
  branchId: '', status: 'Active', aniRavaliActive: false, notes: '',
};

/** API field name -> form field name, so server field errors land on the right input. */
const FIELD_MAP: Record<string, keyof FormValues> = {
  name: 'customerName', customerCode: 'customerId', taxRegistrationNo: 'trn', attn: 'attn', email: 'email',
  address: 'address', billingAddress: 'billingAddress', creditLimit: 'attl', phone: 'contactNumber',
  branchId: 'branchId', status: 'status', notes: 'notes',
};

const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

export function CustomerANIFormDialog({ open, onClose, editRecord }: Props) {
  const isEdit = !!editRecord;
  const createMutation = useCreateCustomer();
  const updateMutation = useUpdateCustomer();
  const branches = useApiBranches();
  const submission = useSubmission();
  const [apiError, setApiError] = useState<unknown>(null);
  const [rowVersion, setRowVersion] = useState<number>(editRecord?.rowVersion ?? 0);
  const [reloading, setReloading] = useState(false);

  const {
    register, handleSubmit, reset, setError, formState: { errors },
  } = useForm<FormValues>({ defaultValues: EMPTY });

  useEffect(() => {
    if (!open) return;
    setApiError(null);
    if (editRecord) {
      setRowVersion(editRecord.rowVersion ?? 0);
      reset({
        customerName: editRecord.customerName,
        customerId: editRecord.customerId,
        trn: editRecord.trn,
        attn: editRecord.attn ?? '',
        email: editRecord.email ?? '',
        address: editRecord.address,
        billingAddress: editRecord.billingAddress ?? '',
        attl: editRecord.attl,
        contactNumber: editRecord.contactNumber,
        branchId: editRecord.branchId ?? '',
        status: editRecord.status,
        aniRavaliActive: editRecord.aniRavaliActive,
        notes: editRecord.notes ?? '',
      });
    } else {
      reset(EMPTY);
    }
  }, [open, editRecord, reset]);

  const pending = createMutation.isPending || updateMutation.isPending;

  const onSubmit = async (values: FormValues) => {
    setApiError(null);
    const body = {
      name: values.customerName.trim(),
      taxRegistrationNo: orNull(values.trn),
      attn: orNull(values.attn),
      email: orNull(values.email),
      phone: values.contactNumber.trim(),
      address: values.address.trim(),
      billingAddress: orNull(values.billingAddress),
      creditLimit: Number.isFinite(values.attl) ? values.attl : 0,
      status: customerStatusToApi(values.status),
      branchId: values.branchId || null,
      aniRavaliActive: values.aniRavaliActive,
      notes: orNull(values.notes),
    };
    try {
      if (isEdit && editRecord) {
        await updateMutation.mutateAsync({ id: editRecord.id, rowVersion, patch: body });
        toastSuccess('Customer updated');
      } else {
        await createMutation.mutateAsync({
          body: { ...body, ...(values.customerId.trim() ? { customerCode: values.customerId.trim() } : {}) },
          submissionId: submission.id(),
        });
        submission.renew();
        toastSuccess('Customer created');
      }
      onClose();
    } catch (err) {
      // The dialog stays open and the entered values stay in the form.
      setApiError(err);
      for (const [apiField, message] of Object.entries(describeApiError(err).fieldErrors)) {
        const field = FIELD_MAP[apiField];
        if (field) setError(field, { type: 'server', message });
      }
    }
  };

  const reload = async () => {
    if (!editRecord) return;
    setReloading(true);
    try {
      const latest = await fetchCustomer(editRecord.id);
      setRowVersion(latest.rowVersion); // the entries in the form are not touched
      setApiError(null);
    } catch (err) {
      setApiError(err);
    } finally {
      setReloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Customer' : 'New Customer'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {apiError != null && <ApiErrorNotice error={apiError} onReload={() => void reload()} reloading={reloading} />}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

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

            <div className="space-y-1.5">
              <Label htmlFor="customerId">Customer ID</Label>
              <Input
                id="customerId" {...register('customerId')} placeholder="Allocated when empty"
                disabled={isEdit} title={isEdit ? 'The customer ID cannot be changed' : undefined}
              />
              {errors.customerId && <p className="text-xs text-rose-500">{errors.customerId.message}</p>}
            </div>

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

            <div className="space-y-1.5">
              <Label htmlFor="attn">Attention (Attn)</Label>
              <Input id="attn" {...register('attn')} placeholder="e.g. Mr. Ahmed Khan" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="contactNumber">Contact Number <span className="text-rose-500">*</span></Label>
              <Input
                id="contactNumber"
                {...register('contactNumber', { required: 'Contact number is required' })}
                placeholder="+971 50 1234567"
                className={cn(errors.contactNumber && 'border-rose-400')}
              />
              {errors.contactNumber && <p className="text-xs text-rose-500">{errors.contactNumber.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" {...register('email')} placeholder="accounts@company.com" />
              {errors.email && <p className="text-xs text-rose-500">{errors.email.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="attl">ATTL (Credit Limit AED)</Label>
              <Input id="attl" type="number" min={0} step={1000} {...register('attl', { valueAsNumber: true })} placeholder="500000" />
              {errors.attl && <p className="text-xs text-rose-500">{errors.attl.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="branchId">Branch</Label>
              <select
                id="branchId"
                {...register('branchId')}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">No branch</option>
                {(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>

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
                <option value="Blacklisted">Blacklisted</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="aniRavaliActive">ANI Ravali</Label>
              <select
                id="aniRavaliActive"
                {...register('aniRavaliActive', { setValueAs: (v) => v === 'true' || v === true })}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="false">Inactive</option>
                <option value="true">Active</option>
              </select>
            </div>

            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="address">Address <span className="text-rose-500">*</span></Label>
              <Input
                id="address"
                {...register('address', { required: 'Address is required' })}
                placeholder="e.g. 42 Sheikh Zayed Rd, Dubai, UAE"
                className={cn(errors.address && 'border-rose-400')}
              />
              {errors.address && <p className="text-xs text-rose-500">{errors.address.message}</p>}
            </div>

            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="billingAddress">Billing Address</Label>
              <Input id="billingAddress" {...register('billingAddress')} placeholder="Same as address if not different" />
            </div>

            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <textarea
                id="notes"
                {...register('notes')}
                rows={2}
                placeholder="Optional notes…"
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Customer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
