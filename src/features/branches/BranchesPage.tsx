import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBranches, useCreateBranch, useUpdateBranch, useDeleteBranch } from '@/hooks/useQueries';
import { LoadingState } from '@/components/common/EmptyState';
import { toastSuccess, toastError } from '@/lib/toast-helper';
import type { Branch } from '@/types';
import { Plus, Pencil, Trash2, Building2 } from 'lucide-react';

export function BranchesPage() {
  const { data: branches, isLoading } = useBranches();
  const createB = useCreateBranch();
  const updateB = useUpdateBranch();
  const deleteB = useDeleteBranch();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);

  const columns: Column<Branch>[] = [
    {
      key: 'name', header: 'Branch', sortable: true,
      render: (b) => (
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Building2 className="h-4 w-4" />
          </div>
          <span className="font-medium text-foreground">{b.name}</span>
        </div>
      ),
    },
    { key: 'code', header: 'Code', sortable: true, render: (b) => <span className="font-mono text-xs text-muted-foreground">{b.code}</span> },
    { key: 'city', header: 'City', sortable: true, render: (b) => <span className="text-muted-foreground">{b.city || '—'}</span> },
    { key: 'country', header: 'Country', sortable: true, render: (b) => <span className="text-muted-foreground">{b.country}</span> },
    { key: 'manager', header: 'Manager', render: (b) => <span className="text-muted-foreground">{b.manager || '—'}</span> },
    { key: 'machineCount', header: 'Machines', sortable: true, render: (b) => <span className="tabular-nums">{b.machineCount ?? 0}</span> },
    {
      key: 'actions', header: '',
      render: (b) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setEditing(b); setOpen(true); }}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={(e) => {
            e.stopPropagation();
            deleteB.mutate(b.id, { onSuccess: () => toastSuccess('Branch removed'), onError: () => toastError('Could not remove branch') });
          }}>
            <Trash2 className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Branches"
        description={`${branches?.length ?? 0} branch${(branches?.length ?? 0) === 1 ? '' : 'es'} in your company`}
        actions={<Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="mr-1.5 h-4 w-4" /> Add Branch</Button>}
      />

      {isLoading ? <LoadingState /> : (
        <DataTable
          columns={columns}
          data={branches ?? []}
          searchable
          searchPlaceholder="Search branches..."
          searchKeys={['name', 'code', 'city', 'manager']}
          rowKey={(b) => b.id}
          pageSize={12}
        />
      )}

      <BranchDialog
        open={open}
        onClose={() => { setOpen(false); setEditing(null); }}
        branch={editing}
        onSave={(data) => {
          if (editing) {
            updateB.mutate({ id: editing.id, data }, {
              onSuccess: () => { toastSuccess('Branch updated'); setOpen(false); setEditing(null); },
              onError: () => toastError('Could not update branch'),
            });
          } else {
            createB.mutate(data, {
              onSuccess: () => { toastSuccess('Branch added'); setOpen(false); },
              onError: () => toastError('Could not add branch'),
            });
          }
        }}
      />
    </div>
  );
}

function BranchDialog({ open, onClose, branch, onSave }: {
  open: boolean; onClose: () => void; branch: Branch | null;
  onSave: (data: Partial<Branch>) => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState<'UAE' | 'KSA'>('UAE');
  const [manager, setManager] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(branch?.name ?? '');
    setCode(branch?.code ?? '');
    setCity(branch?.city ?? '');
    setCountry((branch?.country as 'UAE' | 'KSA') ?? 'UAE');
    setManager(branch?.manager ?? '');
  }, [open, branch]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{branch ? 'Edit Branch' : 'Add Branch'}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => { e.preventDefault(); onSave({ name, code, city, country, manager }); }}
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <label className="text-sm font-medium text-foreground">Branch name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dubai Main" required />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Code</label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="DXB" required />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Country</label>
              <Select value={country} onValueChange={(v) => setCountry(v as 'UAE' | 'KSA')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="UAE">UAE</SelectItem>
                  <SelectItem value="KSA">KSA</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">City</label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Dubai" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Manager</label>
              <Input value={manager} onChange={(e) => setManager(e.target.value)} placeholder="Manager name" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">{branch ? 'Update' : 'Add Branch'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
