import { CollectionNotePage } from '@/features/collection/CollectionNotePage';
import { appCreateTransportJob, appMachineResolver } from '@/features/fleet/collectionWiring';

/** Route wrapper: supplies the machine resolver and transport-job callback. */
export function CollectionNoteRoute() {
  return <CollectionNotePage machines={appMachineResolver} createTransportJob={appCreateTransportJob} />;
}

export default CollectionNoteRoute;
