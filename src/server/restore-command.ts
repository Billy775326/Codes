import { dataDirectory } from './data-directory.js';
import { restoreDatabase } from './restore-database.js';

try {
  const previous = await restoreDatabase(dataDirectory());
  console.log('Database restored. Start Codes with the same data directory.');
  console.log('Previous database:', previous);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Database restore failed.');
  process.exitCode = 1;
}
