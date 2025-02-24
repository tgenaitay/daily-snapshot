import { SnapshotService } from './services/snapshot.service.js';
import { SourceService } from './services/source.service.js';

async function runDailySnapshots() {
  const sourceService = new SourceService();
  const snapshotService = new SnapshotService();
  
  try {
    const activeSources = await sourceService.listSources(true);
    console.log(`Found ${activeSources.length} active sources we need to snapshot`);

    for (const source of activeSources) {
      try {
        await snapshotService.captureSnapshot(source.url);
        console.log(`Snapshot taken for ${source.url}`);
      } catch (error) {
        console.error(`Failed snapshot for ${source.url}:`, error.message);
      }
    }
  } catch (error) {
    console.error('Error fetching sources:', error.message);
    process.exit(1); // Exit with error code if critical failure
  }
  
  console.log('Daily snapshot job completed');
  process.exit(0); // Exit successfully
}

runDailySnapshots();