import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingState } from '@/components/common/EmptyState';
import { ApiErrorNotice, describeApiError } from '@/components/common/ApiStatus';
import {
  fetchMachineModel, useCreateMachineModel, useMachineModels, useSubmission, useUpdateMachineModel,
} from '@/hooks/useApiResources';
import type { MachineModelDto } from '../../../shared/dto/index';
import { toastSuccess } from '@/lib/toast-helper';

interface ModelForm { make: string; model: string; category: string; powerSource: string; workingHeightM: string; capacityKg: string }
const EMPTY: ModelForm = { make: '', model: '', category: '', powerSource: '', workingHeightM: '', capacityKg: '' };
const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

function formOf(m: MachineModelDto): ModelForm {
  return {
    make: m.make, model: m.model, category: m.category, powerSource: m.powerSource ?? '',
    workingHeightM: m.workingHeightM ?? '', capacityKg: m.capacityKg ?? '',
  };
}

/** Lists machine models and creates or edits them through `/api/v1/machine-models`. */
export function MachineModelsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const models = useMachineModels();
  const create = useCreateMachineModel();
  const update = useUpdateMachineModel();
  const submission = useSubmission();
  const [editing, setEditing] = useState<MachineModelDto | null>(null);
  const [form, setForm] = useState<ModelForm>(EMPTY);
  const [rowVersion, setRowVersion] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [reloading, setReloading] = useState(false);

  const set = (k: keyof ModelForm, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const startNew = () => { setEditing(null); setForm(EMPTY); setError(null); };
  const startEdit = (m: MachineModelDto) => { setEditing(m); setForm(formOf(m)); setRowVersion(m.rowVersion); setError(null); };
  const valid = form.make.trim() && form.model.trim() && form.category.trim();
  const fieldErrors = error ? describeApiError(error).fieldErrors : {};

  const save = async () => {
    setError(null);
    const body = {
      make: form.make.trim(), model: form.model.trim(), category: form.category.trim(), powerSource: orNull(form.powerSource),
      workingHeightM: orNull(form.workingHeightM), capacityKg: orNull(form.capacityKg),
    };
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, rowVersion, patch: body });
        toastSuccess('Model updated');
      } else {
        await create.mutateAsync({ body, submissionId: submission.id() });
        submission.renew();
        toastSuccess('Model created');
      }
      startNew();
    } catch (err) {
      setError(err); // the form keeps what the user entered
    }
  };

  const reload = async () => {
    if (!editing) return;
    setReloading(true);
    try {
      setRowVersion((await fetchMachineModel(editing.id)).rowVersion);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setReloading(false);
    }
  };

  const field = (k: keyof ModelForm, label: string, required = false) => (
    <div className="space-y-1" key={k}>
      <label htmlFor={`mm-${k}`} className="text-xs font-medium text-muted-foreground">{label}{required && <span className="text-rose-500"> *</span>}</label>
      <Input id={`mm-${k}`} value={form[k]} onChange={(e) => set(k, e.target.value)} />
      {fieldErrors[k] && <p className="text-xs text-rose-500">{fieldErrors[k]}</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Machine models</DialogTitle></DialogHeader>
        {models.isLoading && <LoadingState className="py-6" />}
        {models.isError && <ApiErrorNotice error={models.error} onRetry={() => void models.refetch()} />}
        {models.data && (
          <ul className="max-h-48 space-y-1 overflow-y-auto text-sm" data-testid="model-list">
            {models.data.length === 0 && <li className="text-muted-foreground">No models yet.</li>}
            {models.data.map((m) => (
              <li key={m.id} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5">
                <span>{m.make} {m.model} <span className="text-xs text-muted-foreground">{m.category}</span></span>
                <Button size="sm" variant="outline" onClick={() => startEdit(m)}>Edit</Button>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-3 rounded-md border border-border p-3">
          <p className="text-sm font-medium">{editing ? `Edit ${editing.make} ${editing.model}` : 'New model'}</p>
          {error != null && <ApiErrorNotice error={error} onReload={() => void reload()} reloading={reloading} />}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {field('make', 'Make', true)}
            {field('model', 'Model', true)}
            {field('category', 'Category', true)}
            {field('powerSource', 'Power source')}
            {field('workingHeightM', 'Working height (m)')}
            {field('capacityKg', 'Capacity (kg)')}
          </div>
          <div className="flex justify-end gap-2">
            {editing && <Button variant="outline" onClick={startNew}>New model</Button>}
            <Button disabled={!valid || create.isPending || update.isPending} onClick={() => void save()}>
              {editing ? 'Save model' : 'Create model'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
