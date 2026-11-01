import { useState } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { Avatar } from '@/components/common/Avatar';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { useAuthStore } from '@/store/authStore';
import { useOrgStore, type OrgAccount } from '@/store/orgStore';
import { formatDate } from '@/utils/format';
import { toastSuccess, toastError } from '@/lib/toast-helper';
import { TeamMemberDialog } from './TeamMemberDialog';
import { RoleAppAccess } from './RoleAppAccess';
import { Plus, ShieldCheck, Copy, Trash2, Pencil, Crown } from 'lucide-react';

export function TeamPage() {
  const user = useAuthStore((s) => s.user);
  const membersOf = useOrgStore((s) => s.membersOf);
  const getOrg = useOrgStore((s) => s.getOrg);
  const deleteMember = useOrgStore((s) => s.deleteMember);
  // subscribe to accounts so the list re-renders after add/edit/delete
  const accounts = useOrgStore((s) => s.accounts);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<OrgAccount | null>(null);

  if (!user) return null;

  const org = getOrg(user.orgId);
  const isOwner = user.isOwner || user.role === 'Managing Director' || user.role === 'Executive Manager';

  if (!isOwner) {
    return (
      <div className="space-y-5">
        <PageHeader title="Team" description={org?.name} />
        <EmptyState icon={ShieldCheck} title="Owner access only" description="Only the company owner can manage team members and roles." />
      </div>
    );
  }

  const members = accounts.length >= 0 ? membersOf(user.orgId) : [];

  const copyCode = () => {
    if (org?.code) {
      navigator.clipboard?.writeText(org.code);
      toastSuccess(`Company code ${org.code} copied`);
    }
  };

  const handleDelete = (m: OrgAccount) => {
    if (m.isOwner) { toastError("You can't remove the owner"); return; }
    deleteMember(m.id);
    toastSuccess(`${m.name} removed`);
  };

  const columns: Column<OrgAccount>[] = [
    {
      key: 'name', header: 'Member', sortable: true,
      render: (m) => (
        <div className="flex items-center gap-3">
          <Avatar name={m.name} color={m.avatarColor} size="sm" />
          <div className="flex flex-col">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              {m.name}
              {m.isOwner && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"><Crown className="h-2.5 w-2.5" /> Owner</span>}
            </span>
            <span className="text-xs text-muted-foreground">{m.email}</span>
          </div>
        </div>
      ),
    },
    { key: 'role', header: 'Department / Role', sortable: true, render: (m) => <span className="text-sm text-foreground">{m.role}</span> },
    { key: 'branchName', header: 'Branch', sortable: true, render: (m) => <span className="text-muted-foreground">{m.branchName}</span> },
    { key: 'password', header: 'Password', render: (m) => <span className="font-mono text-xs text-muted-foreground">{m.password}</span> },
    { key: 'createdAt', header: 'Added', sortable: true, render: (m) => <span className="text-xs text-muted-foreground">{formatDate(m.createdAt)}</span> },
    {
      key: 'actions', header: '',
      render: (m) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setEditing(m); setDialogOpen(true); }}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {!m.isOwner && (
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleDelete(m); }}>
              <Trash2 className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Team"
        description={`${members.length} member${members.length === 1 ? '' : 's'} in ${org?.name ?? 'your company'}`}
        actions={<Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}><Plus className="mr-1.5 h-4 w-4" /> Add Member</Button>}
      />

      {/* Company info card */}
      <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Company</p>
          <p className="text-lg font-semibold text-foreground">{org?.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Company Code</p>
            <p className="font-mono text-base font-semibold text-foreground">{org?.code}</p>
          </div>
          <Button variant="outline" size="sm" onClick={copyCode}><Copy className="mr-1.5 h-4 w-4" /> Copy</Button>
        </div>
      </Card>

      <DataTable
        columns={columns}
        data={members}
        searchable
        searchPlaceholder="Search members by name, email, role..."
        searchKeys={['name', 'email', 'role', 'branchName']}
        rowKey={(m) => m.id}
        pageSize={12}
      />

      <p className="text-xs text-muted-foreground">
        Members sign in on the normal login page using the email and password shown here.
      </p>

      {/* Role → App access (which apps each role can open) */}
      <RoleAppAccess />

      <TeamMemberDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        orgId={user.orgId}
        member={editing}
      />
    </div>
  );
}
