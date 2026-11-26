import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class SmsMobileApiApi implements ICredentialType {
  name = 'smsMobileApiApi';
  displayName = 'SMSMobileAPI API';
  icon = 'file:../icons/smsmobileapi.svg' as const;
  documentationUrl = 'https://smsmobileapi.com/doc/';
  properties: INodeProperties[] = [
    {
      displayName: 'API Key', name: 'apiKey', type: 'string',
      typeOptions: { password: true }, required: true, default: '',
      description: 'Your SMSMobileAPI account API key. Keep it private.',
    },
  ];
  // Used by the credential test. Runtime POST requests carry the key in the body.
  authenticate: IAuthenticateGeneric = {
    type: 'generic', properties: { qs: { apikey: '={{$credentials.apiKey}}' } },
  };
  test: ICredentialTestRequest = {
    request: { baseURL: 'https://api.smsmobileapi.com', url: '/gateway/mobile/list/', method: 'GET' },
  };
}
