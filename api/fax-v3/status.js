import { createFaxHandler } from '../../server/fax-v3/handler.js';
export const config = { api: { bodyParser: false } };
export default createFaxHandler('status');
