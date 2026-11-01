import { useState } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Calendar, List } from 'lucide-react';
import { CalendarView } from './CalendarView';
import { BookingFormDialog } from './BookingFormDialog';

export function PlannerPage() {
  const [createBookingOpen, setCreateBookingOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('calendar');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Planner (Hire Desk)"
        description="14-day booking calendar with exact Excel layout and colors"
        actions={
          <Button size="sm" onClick={() => setCreateBookingOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> New Booking
          </Button>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="calendar">
            <Calendar className="mr-2 h-4 w-4" />
            Calendar View
          </TabsTrigger>
          <TabsTrigger value="list">
            <List className="mr-2 h-4 w-4" />
            List View
          </TabsTrigger>
        </TabsList>

        <TabsContent value="calendar" className="mt-4">
          <CalendarView />
        </TabsContent>

        <TabsContent value="list" className="mt-4">
          {/* TODO: Add existing list view */}
          <div className="text-center p-8 text-gray-500">
            List view coming soon...
          </div>
        </TabsContent>
      </Tabs>

      <BookingFormDialog
        open={createBookingOpen}
        onClose={() => setCreateBookingOpen(false)}
      />
    </div>
  );
}
