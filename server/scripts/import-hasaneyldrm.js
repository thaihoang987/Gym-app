import { importHasaneyldrmDataset, migrate } from '../db.js';

migrate();
const count = importHasaneyldrmDataset();
console.log(`Imported ${count} exercises from hasaneyldrm dataset.`);
