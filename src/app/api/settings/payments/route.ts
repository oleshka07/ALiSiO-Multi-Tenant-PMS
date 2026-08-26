import { getPaymentSettings, updateIntegrationCredentials } from '@auth';

export const GET = getPaymentSettings;
// The same PUT as the integrations screen: one encrypted path for every key
// this product stores, payment gateways included.
export const PUT = updateIntegrationCredentials;
