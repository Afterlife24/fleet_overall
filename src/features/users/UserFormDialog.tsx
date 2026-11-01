import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Card } from '@/components/ui/card';
import { useBranches, useCreateUser, useUpdateUser } from '@/hooks/useQueries';
import { toastSuccess, toastError } from '@/lib/toast-helper';
import { User } from '@/types';
import { Label } from '@/components/ui/label';

const userSchema = z.object({
  name:      z.string().min(2, 'Name must be at least 2 characters'),
  email:     z.string().email('Invalid email address'),
  phone:     z.string().regex(/^[\d\s\+\-\(\)]+$/, 'Invalid phone number'),
  status:    z.enum(['Active', 'Inactive']),
  // Roles from overview.md §7 — exact role names
  role: z.enum([
    'Security',
    'Site Supervisor',
    'Field Technician',
    'PHI/PDI Checker',
    'Workshop Coordinator',
    'Workshop Manager',
    'Procurement',
    'Ops Executive',
    'Operations Manager',
    'Sales Executive',
    'Sales Manager',
    'Finance',
    'Executive Manager',
    'Managing Director',
    'Driver',
    'Operator',
  ]),
  branchId:    z.string().min(1, 'Branch is required'),
  permissions: z.array(z.string()),
});

type UserFormData = z.infer<typeof userSchema>;

interface UserFormDialogProps {
  open: boolean;
  onClose: () => void;
  user?: User | null;
}

const PERMISSIONS = [
  { id: 'fleet:view', label: 'View Fleet' },
  { id: 'fleet:edit', label: 'Edit Fleet' },
  { id: 'bookings:view', label: 'View Bookings' },
  { id: 'bookings:create', label: 'Create Bookings' },
  { id: 'workshop:view', label: 'View Workshop' },
  { id: 'workshop:manage', label: 'Manage Workshop' },
  { id: 'inspections:view', label: 'View Inspections' },
  { id: 'inspections:perform', label: 'Perform Inspections' },
  { id: 'reports:view', label: 'View Reports' },
  { id: 'reports:export', label: 'Export Reports' },
  { id: 'users:manage', label: 'Manage Users' },
  { id: 'settings:manage', label: 'Manage Settings' },
];

export function UserFormDialog({ open, onClose, user }: UserFormDialogProps) {
  const { data: branches } = useBranches();
  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();
  const isEditing = !!user;

  const form = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: user ? {
      name: user.name,
      email: user.email,
      role: user.role as any,
      branchId: user.branchId,
      phone: user.phone || '',
      status: (user.status || 'Active') as any,
      permissions: (user as any).permissions || [],
    } : {
      status: 'Active',
      permissions: [],
    },
  });

  const onSubmit = async (data: UserFormData) => {
    try {
      if (isEditing) {
        await updateMutation.mutateAsync({ id: user.id, data: data as any });
        toastSuccess('User updated successfully');
      } else {
        await createMutation.mutateAsync(data as any);
        toastSuccess('User created successfully');
      }
      form.reset();
      onClose();
    } catch (error) {
      toastError(isEditing ? 'Failed to update user' : 'Failed to create user');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit User' : 'Add New User'}</DialogTitle>
          <DialogDescription>
            {isEditing ? 'Update user account details and permissions' : 'Create a new user account with role and permissions'}
          </DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Basic Information */}
            <Card className="p-4 bg-muted/30">
              <h3 className="text-sm font-semibold mb-3">Basic Information</h3>
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl><Input placeholder="John Doe" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email Address</FormLabel>
                    <FormControl><Input type="email" placeholder="john@example.com" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="phone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl><Input placeholder="+971 50 123 4567" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="Active">Active</SelectItem>
                        <SelectItem value="Inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </Card>

            {/* Role & Branch */}
            <Card className="p-4 bg-muted/30">
              <h3 className="text-sm font-semibold mb-3">Role & Assignment</h3>
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="role" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role (§7)</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="Security">Security (Gate only)</SelectItem>
                        <SelectItem value="Site Supervisor">Site Supervisor</SelectItem>
                        <SelectItem value="Field Technician">Field Technician</SelectItem>
                        <SelectItem value="PHI/PDI Checker">PHI/PDI Checker</SelectItem>
                        <SelectItem value="Workshop Coordinator">Workshop Coordinator</SelectItem>
                        <SelectItem value="Workshop Manager">Workshop Manager</SelectItem>
                        <SelectItem value="Procurement">Procurement (Parts only)</SelectItem>
                        <SelectItem value="Ops Executive">Ops Executive / Hire Desk</SelectItem>
                        <SelectItem value="Operations Manager">Operations Manager</SelectItem>
                        <SelectItem value="Sales Executive">Sales Executive</SelectItem>
                        <SelectItem value="Sales Manager">Sales Manager</SelectItem>
                        <SelectItem value="Finance">Finance / Credit Control</SelectItem>
                        <SelectItem value="Executive Manager">Executive Manager</SelectItem>
                        <SelectItem value="Managing Director">Managing Director</SelectItem>
                        <SelectItem value="Driver">Driver (Run-sheet only)</SelectItem>
                        <SelectItem value="Operator">Operator (Timesheet only)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="branchId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Branch</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {branches?.map(b => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </Card>

            {/* Permissions */}
            <Card className="p-4 bg-muted/30">
              <h3 className="text-sm font-semibold mb-3">Permissions</h3>
              <FormField
                control={form.control}
                name="permissions"
                render={() => (
                  <FormItem>
                    <div className="grid grid-cols-2 gap-3">
                      {PERMISSIONS.map((permission) => (
                        <FormField
                          key={permission.id}
                          control={form.control}
                          name="permissions"
                          render={({ field }) => {
                            return (
                              <FormItem
                                key={permission.id}
                                className="flex flex-row items-center space-x-2 space-y-0"
                              >
                                <FormControl>
                                  <Checkbox
                                    checked={field.value?.includes(permission.id)}
                                    onCheckedChange={(checked) => {
                                      return checked
                                        ? field.onChange([...field.value, permission.id])
                                        : field.onChange(
                                            field.value?.filter(
                                              (value) => value !== permission.id
                                            )
                                          );
                                    }}
                                  />
                                </FormControl>
                                <FormLabel className="text-sm font-normal cursor-pointer">
                                  {permission.label}
                                </FormLabel>
                              </FormItem>
                            );
                          }}
                        />
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Card>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending ? 'Saving...' : isEditing ? 'Update User' : 'Create User'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
