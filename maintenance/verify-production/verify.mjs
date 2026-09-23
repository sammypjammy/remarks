import { productionCheck } from './validate.mjs';

const result = productionCheck(process.env);
const passed = result === 'PASS';
console.log(passed ? 'PASS' : `FAIL ${result}`);
process.exitCode = passed ? 0 : 1;
