import { resolve } from 'node:path';
import { restoreDatabase } from './restore-database.js';

try {
  const previous = await restoreDatabase(resolve(process.env.CODES_DATA_DIR ?? '.local'));
  console.log('Database restored. Start Codes with the same data directory.');
  console.log('Previous database:', previous);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Database restore failed.');
  process.exitCode = 1;
}
