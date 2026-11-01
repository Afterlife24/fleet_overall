import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOrgStore, type OrgAccount } from '@/store/orgStore';
import { rolePageAccess, type UserRole } from '@/store/authStore';
import { toastSuccess, toastError } from '@/lib/toast-helper';

// Departments the owner can assign — reuse the app's existing roles.
const ROLE_OPTIONS = Object.keys(rolePageAccess) as UserRole[];

interface Props {
  open: boolean;
  onClose: () => void;
  orgId: string;
  member?: OrgAccount | null;
}

export function TeamMemberDialog({ open, onClose, orgId, member }: Props) {
  const createMember = useOrgStore((s) => s.createMember);
  const updateMember = useOrgStore((s) => s.updateMember);
  const isEditing = !!member;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('Ops Executive');
  const [branchName, setBranchName] = useState('Head Office');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (member) {
      setName(member.name);
      setEmail(member.email);
      setPassword(member.password);
      setRole(member.role);
      setBranchName(member.branchName);
    } else {
      setName(''); setEmail(''); setPassword(''); setRole('Ops Executive'); setBranchName('Head Office');
    }
    setError('');
  }, [open, member]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    const result = isEditing
      ? updateMember(member!.id, { name, email, password, role, branchName })
      : createMember(orgId, { name, email, password, role, branchName });
    setSaving(false);
    if (!result.success) {
      setError(result.error || 'Something went wrong');
      return;
    }
    toastSuccess(isEditing ? 'Member updated' : `${name} added — they can now sign in`);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Member' : 'Add Member'}</DialogTitle>
          <DialogDescription>
            {isEditing ? 'Update this member’s details.' : 'Create a login for a team member and assign their department.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ahmed Khan" required />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Email (used to sign in)</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ahmed@yourcompany.com" required />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Password</label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="temp1234" required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Department / Role</label>
              <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Branch</label>
              <Input value={branchName} onChange={(e) => setBranchName(e.target.value)} placeholder="Head Office" />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : isEditing ? 'Update' : 'Add Member'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
