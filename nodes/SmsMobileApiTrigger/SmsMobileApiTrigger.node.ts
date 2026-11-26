import type {
  IDataObject,
  ILoadOptionsFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { apiRows, mobileOptions, smsMobileApiRequest } from '../SmsMobileApi/shared';

type TriggerState = {
  scope?: string;
  initialized?: boolean;
  seen?: string[];
};

function eventTime(row: IDataObject, event: string): number {
  if (event === 'sms.received') {
    const seconds = Number(row.timestamp_unix || 0);
    return seconds > 0 ? seconds * 1000 : 0;
  }
  const milliseconds = Number(row.call_date_ms || row.date_ms || 0);
  if (milliseconds > 0) return milliseconds;
  const text = String(row.call_datetime_utc || row.date || row.created_at || '');
  const parsed = Date.parse(text.includes('T') ? text : text.replace(' ', 'T') + 'Z');
  return Number.isFinite(parsed) ? parsed : 0;
}

function eventKey(row: IDataObject, event: string): string {
  const id = row.guid || row.id || row.call_id || row.guid_message;
  if (id !== undefined && id !== null && id !== '') return `${event}:${String(id)}`;
  return `${event}:${JSON.stringify([
    row.sIdentifiantPhone || row.sIdentifiant || row.mobile_sid || '',
    row.number || row.phone_number || '',
    row.timestamp_unix || row.call_date_ms || row.call_datetime_utc || row.date || '',
    row.duration_sec || row.duration || '',
    row.message || '',
  ])}`;
}

export class SmsMobileApiTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'SMSMobileAPI Trigger', name: 'smsMobileApiTrigger',
    icon: { light: 'file:../../icons/smsmobileapi.svg', dark: 'file:../../icons/smsmobileapi.dark.svg' }, group: ['trigger'], version: 1,
    subtitle: '={{$parameter["event"]}}',
    description: 'Start a workflow when a new SMS or call is synchronized',
    defaults: { name: 'SMSMobileAPI Trigger' },
    inputs: [], outputs: [NodeConnectionTypes.Main],
    polling: true,
    credentials: [{ name: 'smsMobileApiApi', required: true }],
    properties: [
      {
        displayName: 'Event', name: 'event', type: 'options', noDataExpression: true,
        options: [
          { name: 'SMS Received', value: 'sms.received' },
          { name: 'Call Missed', value: 'call.missed' },
          { name: 'Call Incoming', value: 'call.incoming' },
          { name: 'Call Outgoing', value: 'call.outgoing' },
        ], default: 'sms.received',
      },
      {
        displayName: 'Mobile Name or ID', name: 'mobileSid', type: 'options',
        typeOptions: { loadOptionsMethod: 'getMobiles' },
        displayOptions: { show: { event: ['sms.received'] } },
        default: '', description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
      },
      {
        displayName: 'Lookback (Hours)', name: 'lookbackHours', type: 'number',
        typeOptions: { minValue: 1, maxValue: 168 }, default: 48,
        description: 'Recheck this rolling window to catch delayed mobile synchronization; existing records are ignored on first activation',
      },
    ],
  };

  methods = {
    loadOptions: {
      async getMobiles(this: ILoadOptionsFunctions) {
        return mobileOptions(await smsMobileApiRequest(this, 'GET', '/gateway/mobile/list/'));
      },
    },
  };

  async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
    const event = String(this.getNodeParameter('event'));
    const sid = event === 'sms.received' ? String(this.getNodeParameter('mobileSid', '')) : '';
    const lookbackHours = Math.max(1, Math.min(168, Number(this.getNodeParameter('lookbackHours', 48))));
    const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;
    const state = this.getWorkflowStaticData('node') as TriggerState;
    const scope = `${event}:${sid}`;
    if (state.scope !== scope) {
      state.scope = scope;
      state.initialized = false;
      state.seen = [];
    }

    let records: IDataObject[] = [];
    if (event === 'sms.received') {
      const response = await smsMobileApiRequest(this, 'GET', '/getsms/', {
        sIdentifiantPhone: sid,
        after_timestamp_unix: Math.floor(cutoff / 1000),
        limit: 500,
      });
      records = apiRows(response, 'sms');
    } else {
      const category = event.split('.')[1];
      if (!['missed', 'incoming', 'outgoing'].includes(category)) return null;
      const pageSize = category === 'missed' ? 500 : 200;
      for (let page = 0; page < 10; page++) {
        const response = await smsMobileApiRequest(this, 'GET', `/call/${category}/list/`, {
          limit: pageSize,
          offset: page * pageSize,
          ...(category === 'missed'
            ? { date_start: new Date(cutoff).toISOString().slice(0, 10) }
            : { date_from_ms: cutoff, sort_by: 'call_date_ms', sort_dir: 'desc' }),
        });
        const batch = apiRows(response, 'calls');
        records.push(...batch);
        if (batch.length < pageSize || batch.some((row) => eventTime(row, event) > 0 && eventTime(row, event) < cutoff)) break;
      }
    }

    const recent = records.filter((row) => !eventTime(row, event) || eventTime(row, event) >= cutoff);
    recent.sort((a, b) => eventTime(a, event) - eventTime(b, event));
    if (this.getMode() === 'manual') {
      const newest = recent[recent.length - 1];
      return newest ? [this.helpers.returnJsonArray([{ ...newest, event }])] : null;
    }

    const known = new Set(state.seen || []);
    const fresh = recent.filter((row) => !known.has(eventKey(row, event)));
    const nextSeen = [...(state.seen || []), ...fresh.map((row) => eventKey(row, event))];
    state.seen = nextSeen.slice(-10000);
    const wasInitialized = state.initialized === true;
    state.initialized = true;
    if (!wasInitialized || fresh.length === 0) return null;
    return [this.helpers.returnJsonArray(fresh.map((row) => ({ ...row, event })))];
  }
}
