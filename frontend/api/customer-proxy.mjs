import { createCustomerProxy } from '../server/customerProxy.mjs';

export default createCustomerProxy();
// Preserve payment evidence bytes; the handler parses/limits the raw stream.
export const config = { api: { bodyParser: false } };
