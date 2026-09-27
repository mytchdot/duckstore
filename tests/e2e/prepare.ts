// Runs before Playwright starts the servers, which refuse to start without the ducks table.
import { recreateSchema } from '../support/database';

await recreateSchema();
