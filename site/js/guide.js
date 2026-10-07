/** The "How to contribute" page: the steps of the Contribute page with all their pictures, to read before starting (steps.js). */
import { STEPS, stepSection } from './steps.js';

document.getElementById('steps').append(...STEPS.map((st, i) => stepSection(st, i + 1, { pictures: 'open' })));
