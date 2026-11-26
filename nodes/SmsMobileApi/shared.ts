import type {
  IDataObject,
  IExecuteFunctions,
  ILoadOptionsFunctions,
  IPollFunctions,
  INodePropertyOptions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

export type ApiContext = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions;

const API_BASE = 'https://api.smsmobileapi.com';

export function objectValue(value: unknown): IDataObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as IDataObject
    : {};
}

export function apiRows(response: IDataObject, kind: 'sms' | 'calls' | 'mobiles'): IDataObject[] {
  const result = objectValue(response.result);
  const names = kind === 'sms' ? ['sms', 'data', 'rows']
    : kind === 'calls' ? ['data', 'rows', 'calls']
      : ['items', 'mobiles', 'mobile', 'devices', 'data', 'rows'];
  for (const container of [response, result]) {
    for (const name of names) {
      const value = container[name];
      if (Array.isArray(value)) {
        const rows = value.map(objectValue).filter((row) => Object.keys(row).length > 0);
        if (kind === 'mobiles' && rows.length === 1 && Array.isArray(rows[0].items)) {
          return rows[0].items.map(objectValue).filter((row) => Object.keys(row).length > 0);
        }
        return rows;
      }
      if (kind === 'mobiles' && value && typeof value === 'object') return [objectValue(value)];
    }
  }
  return [];
}

export function mobileSid(row: IDataObject): string {
  for (const key of ['sid', 'sIdentifiant', 'sIdentifiantPhone', 'identifier', 'device_id', 'mobile_sid']) {
    if (typeof row[key] === 'string' && row[key]) return String(row[key]);
  }
  return '';
}

export function mobileOptions(response: IDataObject): INodePropertyOptions[] {
  const choices: INodePropertyOptions[] = [{ name: 'Automatic / All Mobiles', value: '' }];
  for (const row of apiRows(response, 'mobiles')) {
    const sid = mobileSid(row);
    if (!sid) continue;
    const label = String(row.label || row.name || row.phone_number || row.number || sid);
    choices.push({ name: label === sid ? sid : `${label} (${sid})`, value: sid });
  }
  return choices;
}

export async function smsMobileApiRequest(
  context: ApiContext,
  method: 'GET' | 'POST',
  path: string,
  parameters: Record<string, string | number | boolean | undefined> = {},
): Promise<IDataObject> {
  const credentials = await context.getCredentials('smsMobileApiApi');
  const apiKey = String(credentials.apiKey || '').trim();
  if (!apiKey) throw new NodeOperationError(context.getNode(), 'Add an SMSMobileAPI API key to the credential.');
  const parametersWithKey: Record<string, string> = { apikey: apiKey };
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== '') parametersWithKey[key] = String(value);
  }

  let raw: unknown;
  try {
    raw = await context.helpers.httpRequest(method === 'POST'
      ? {
        method,
        url: API_BASE + path,
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(parametersWithKey).toString(),
        json: false,
        timeout: 30000,
      }
      : {
        method,
        url: API_BASE + path,
        headers: { Accept: 'application/json' },
        qs: parametersWithKey,
        json: false,
        timeout: 30000,
      });
  } catch {
    // Do not include the request URL or helper error: GET endpoints put the API key in the query.
    throw new NodeOperationError(context.getNode(), 'SMSMobileAPI request failed. Check the key, subscription, endpoint availability, and network connection.');
  }

  let response: IDataObject;
  try {
    response = objectValue(typeof raw === 'string' ? JSON.parse(raw) : raw);
  } catch {
    throw new NodeOperationError(context.getNode(), 'SMSMobileAPI returned a response that is not JSON.');
  }
  if (Object.keys(response).length === 0) {
    throw new NodeOperationError(context.getNode(), 'SMSMobileAPI returned an empty response.');
  }
  const result = objectValue(response.result);
  const error = result.error ?? response.error;
  if (error !== undefined && error !== null && error !== '' && error !== 0 && error !== '0' && error !== false) {
    throw new NodeOperationError(context.getNode(), `SMSMobileAPI rejected the request: ${String(error).slice(0, 120)}`);
  }
  if (response.success === false) {
    throw new NodeOperationError(context.getNode(), `SMSMobileAPI rejected the request: ${String(response.message || 'unknown error').slice(0, 120)}`);
  }
  return response;
}
