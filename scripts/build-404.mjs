// Writes public/404.html from the shared template (src/error-page.js). Run after changing the template.
import fs from 'node:fs';
import { errorPage } from '../src/error-page.js';

fs.writeFileSync('public/404.html', errorPage({ status: 404 }));
console.log('public/404.html written');
