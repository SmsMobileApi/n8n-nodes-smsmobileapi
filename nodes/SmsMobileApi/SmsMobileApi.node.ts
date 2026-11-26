import type {
  IDataObject,
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { apiRows, mobileOptions, smsMobileApiRequest } from './shared';

const mobileField = {
  displayName: 'Mobile Name or ID', name: 'mobileSid', type: 'options' as const,
  typeOptions: { loadOptionsMethod: 'getMobiles' }, default: '',
  description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>. Leave automatic to use the first available sender or all received SMS.',
};

export class SmsMobileApi implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'SMSMobileAPI', name: 'smsMobileApi',
    icon: { light: 'file:../../icons/smsmobileapi.svg', dark: 'file:../../icons/smsmobileapi.dark.svg' }, group: ['transform'], version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: 'Send SMS and read received SMS, call logs, and connected mobiles',
    defaults: { name: 'SMSMobileAPI' },
    inputs: [NodeConnectionTypes.Main], outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [{ name: 'smsMobileApiApi', required: true }],
    properties: [
      {
        displayName: 'Resource', name: 'resource', type: 'options', noDataExpression: true,
        options: [
          { name: 'SMS', value: 'sms' },
          { name: 'Call', value: 'call' },
          { name: 'Mobile', value: 'mobile' },
        ], default: 'sms',
      },
      {
        displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
        displayOptions: { show: { resource: ['sms'] } },
        options: [
          { name: 'Send', value: 'send', action: 'Send an SMS' },
          { name: 'Get Received SMS', value: 'received', action: 'Get received SMS' },
        ], default: 'send',
      },
      {
        displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
        displayOptions: { show: { resource: ['call'] } },
        options: [
          { name: 'Get Missed Calls', value: 'missed', action: 'Get missed calls' },
          { name: 'Get Incoming Calls', value: 'incoming', action: 'Get incoming calls' },
          { name: 'Get Outgoing Calls', value: 'outgoing', action: 'Get outgoing calls' },
        ], default: 'missed',
      },
      {
        displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
        displayOptions: { show: { resource: ['mobile'] } },
        options: [
          { name: 'Get All Mobiles', value: 'list', action: 'Get connected mobiles' },
          { name: 'Get Mobile Status', value: 'status', action: 'Get a mobile status' },
        ], default: 'list',
      },
      {
        displayName: 'Recipient', name: 'recipient', type: 'string', required: true,
        displayOptions: { show: { resource: ['sms'], operation: ['send'] } },
        default: '', placeholder: '+32495898697', description: 'Recipient number in international format',
      },
      {
        displayName: 'Message', name: 'message', type: 'string', required: true,
        typeOptions: { rows: 4 },
        displayOptions: { show: { resource: ['sms'], operation: ['send'] } },
        default: '', description: 'Text to send from the connected mobile',
      },
      {
        ...mobileField,
        displayOptions: { show: { resource: ['sms'], operation: ['send', 'received'] } },
      },
      {
        displayName: 'SIM Port', name: 'simPort', type: 'options',
        displayOptions: { show: { resource: ['sms'], operation: ['send'] } },
        options: [
          { name: 'Automatic', value: '' }, { name: 'SIM 1', value: '1' }, { name: 'SIM 2', value: '2' },
        ], default: '', description: 'Optional Android SIM port. Automatic uses the first active SIM.',
      },
      {
        displayName: 'After Timestamp (Unix Seconds)', name: 'afterTimestamp', type: 'number',
        displayOptions: { show: { resource: ['sms'], operation: ['received'] } },
        default: 0, description: 'Only return received SMS after this Unix timestamp. Zero returns all available SMS.',
      },
      {
        displayName: 'Only Unread', name: 'onlyUnread', type: 'boolean',
        displayOptions: { show: { resource: ['sms'], operation: ['received'] } },
        default: false, description: 'Whether to filter by SMSMobileAPI API read status without changing it',
      },
      {
        displayName: 'Mobile SID', name: 'statusSid', type: 'string', required: true,
        displayOptions: { show: { resource: ['mobile'], operation: ['status'] } },
        default: '', description: 'Exact identifier of the mobile to inspect',
      },
      {
        displayName: 'Limit', name: 'limit', type: 'number', typeOptions: { minValue: 1, maxValue: 500 },
        displayOptions: { show: { resource: ['call'] } },
        default: 50, description: 'Max number of results to return',
      },
      {
        displayName: 'Offset', name: 'offset', type: 'number', typeOptions: { minValue: 0 },
        displayOptions: { show: { resource: ['call'] } },
        default: 0, description: 'Zero-based call-log pagination offset',
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

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const output: INodeExecutionData[] = [];
    for (let index = 0; index < this.getInputData().length; index++) {
      try {
        const resource = this.getNodeParameter('resource', index) as string;
        const operation = this.getNodeParameter('operation', index) as string;
        let response: IDataObject;
        let rows: IDataObject[] | undefined;
        if (resource === 'sms' && operation === 'send') {
          const recipient = String(this.getNodeParameter('recipient', index)).trim();
          const message = String(this.getNodeParameter('message', index));
          if (!recipient || !message) throw new NodeOperationError(this.getNode(), 'Recipient and message are required.', { itemIndex: index });
          response = await smsMobileApiRequest(this, 'POST', '/sendsms/', {
            recipients: recipient, message,
            sIdentifiant: String(this.getNodeParameter('mobileSid', index, '')),
            port: String(this.getNodeParameter('simPort', index, '')),
          });
          rows = [Object.keys(response.result || {}).length ? response.result as IDataObject : response];
        } else if (resource === 'sms' && operation === 'received') {
          response = await smsMobileApiRequest(this, 'GET', '/getsms/', {
            sIdentifiantPhone: String(this.getNodeParameter('mobileSid', index, '')),
            after_timestamp_unix: Number(this.getNodeParameter('afterTimestamp', index, 0)) || undefined,
            onlyunread: this.getNodeParameter('onlyUnread', index, false) ? 'yes' : undefined,
          });
          rows = apiRows(response, 'sms');
        } else if (resource === 'call' && ['missed', 'incoming', 'outgoing'].includes(operation)) {
          const max = operation === 'missed' ? 500 : 200;
          response = await smsMobileApiRequest(this, 'GET', `/call/${operation}/list/`, {
            limit: Math.min(max, Math.max(1, Number(this.getNodeParameter('limit', index, 100)))),
            offset: Math.max(0, Number(this.getNodeParameter('offset', index, 0))),
          });
          rows = apiRows(response, 'calls');
        } else if (resource === 'mobile' && ['list', 'status'].includes(operation)) {
          const sid = operation === 'status' ? String(this.getNodeParameter('statusSid', index)).trim() : '';
          if (operation === 'status' && !sid) throw new NodeOperationError(this.getNode(), 'Mobile SID is required.', { itemIndex: index });
          response = await smsMobileApiRequest(this, 'GET', '/gateway/mobile/list/', { sid });
          rows = apiRows(response, 'mobiles');
        } else {
          throw new NodeOperationError(this.getNode(), 'Unsupported resource or operation.', { itemIndex: index });
        }
        if (rows.length === 0) rows = [{ count: 0, data: [] }];
        for (const row of rows) output.push({ json: row, pairedItem: { item: index } });
      } catch (error) {
        if (this.continueOnFail()) {
          output.push({ json: { error: error instanceof Error ? error.message : 'Unknown error' }, pairedItem: { item: index } });
        } else {
          throw new NodeOperationError(this.getNode(), error instanceof Error ? error : 'SMSMobileAPI operation failed.', { itemIndex: index });
        }
      }
    }
    return [output];
  }
}
