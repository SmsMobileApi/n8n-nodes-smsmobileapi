const assert = require('node:assert/strict');
const test = require('node:test');
const { SmsMobileApi } = require('../dist/nodes/SmsMobileApi/SmsMobileApi.node.js');
const { SmsMobileApiTrigger } = require('../dist/nodes/SmsMobileApiTrigger/SmsMobileApiTrigger.node.js');
const { mobileOptions } = require('../dist/nodes/SmsMobileApi/shared.js');

function nodeContext(respond, parameters) {
  const requests = [];
  const state = {};
  return {
    requests,
    state,
    getNode: () => ({ name: 'SMSMobileAPI', type: 'n8n-nodes-smsmobileapi.smsMobileApi' }),
    getCredentials: async () => ({ apiKey: 'test-secret' }),
    getNodeParameter: (name, indexOrFallback) => parameters[name] ?? (typeof indexOrFallback === 'number' ? undefined : indexOrFallback),
    getInputData: () => [{ json: {} }],
    getWorkflowStaticData: () => state,
    getMode: () => 'trigger',
    continueOnFail: () => false,
    helpers: {
      httpRequest: async (options) => {
        requests.push(options);
        return JSON.stringify(await respond(options));
      },
      returnJsonArray: (rows) => rows.map((json) => ({ json })),
    },
  };
}

test('send chooses the API default mobile when no SID is selected and keeps the key out of the URL', async () => {
  const context = nodeContext(async () => ({ result: { error: 0, id: 'queued-1', status: 'queued' } }), {
    resource: 'sms', operation: 'send', recipient: '+32495898697', message: 'Hello',
    mobileSid: '', simPort: '',
  });
  const output = await SmsMobileApi.prototype.execute.call(context);
  const request = context.requests[0];
  const body = new URLSearchParams(request.body);
  assert.equal(request.method, 'POST');
  assert.equal(request.url, 'https://api.smsmobileapi.com/sendsms/');
  assert.equal(body.get('apikey'), 'test-secret');
  assert.equal(body.get('sIdentifiant'), null);
  assert.equal(body.get('port'), null);
  assert.equal(output[0][0].json.id, 'queued-1');
});

test('send targets a selected mobile and SIM port', async () => {
  const context = nodeContext(async () => ({ result: { error: 0, id: 'queued-2' } }), {
    resource: 'sms', operation: 'send', recipient: '+32495898697', message: 'Hello',
    mobileSid: 'phone-2', simPort: '2',
  });
  await SmsMobileApi.prototype.execute.call(context);
  const body = new URLSearchParams(context.requests[0].body);
  assert.equal(body.get('sIdentifiant'), 'phone-2');
  assert.equal(body.get('port'), '2');
});

test('received SMS trigger baselines existing events, then emits one new SMS without marking it read', async () => {
  let messages = [{ id: 1, guid: 'old', timestamp_unix: Math.floor(Date.now() / 1000), sIdentifiantPhone: 'phone-2' }];
  const context = nodeContext(async () => ({ result: { error: '', sms: messages } }), {
    event: 'sms.received', mobileSid: 'phone-2', lookbackHours: 48,
  });
  assert.equal(await SmsMobileApiTrigger.prototype.poll.call(context), null);
  messages = [...messages, { id: 2, guid: 'new', timestamp_unix: Math.floor(Date.now() / 1000), sIdentifiantPhone: 'phone-2' }];
  const output = await SmsMobileApiTrigger.prototype.poll.call(context);
  assert.deepEqual(output[0].map((item) => item.json.guid), ['new']);
  assert.equal(await SmsMobileApiTrigger.prototype.poll.call(context), null);
  assert.equal(context.requests.every((request) => request.url.endsWith('/getsms/')), true);
  assert.equal(context.requests.every((request) => request.qs.sIdentifiantPhone === 'phone-2'), true);
  assert.equal(context.requests.every((request) => !request.qs.onlyunread), true);
});

test('connected mobile API items populate the sender selector and expose mobile status', async () => {
  const response = {
    success: true,
    connected_now: 2,
    items: [
      { sid: 'phone-1', label: 'Office', last_check: { status: 'green' } },
      { sid: 'phone-2', label: 'Support', last_check: { status: 'red' } },
    ],
  };
  assert.deepEqual(mobileOptions(response).map((option) => option.value), ['', 'phone-1', 'phone-2']);
  const context = nodeContext(async (request) => ({ ...response, items: response.items.filter((row) => row.sid === request.qs.sid) }), {
    resource: 'mobile', operation: 'status', statusSid: 'phone-2',
  });
  const output = await SmsMobileApi.prototype.execute.call(context);
  assert.equal(context.requests[0].qs.sid, 'phone-2');
  assert.equal(output[0].length, 1);
  assert.equal(output[0][0].json.last_check.status, 'red');
});

test('missed call trigger detects new records from the call log without replaying its baseline', async () => {
  let calls = [{ number: '+32495898697', date: new Date(Date.now() - 1000).toISOString().slice(0, 19).replace('T', ' ') }];
  const context = nodeContext(async () => ({ success: true, data: calls }), {
    event: 'call.missed', lookbackHours: 48,
  });
  assert.equal(await SmsMobileApiTrigger.prototype.poll.call(context), null);
  calls = [...calls, { number: '+32495898698', date: new Date().toISOString().slice(0, 19).replace('T', ' ') }];
  const output = await SmsMobileApiTrigger.prototype.poll.call(context);
  assert.equal(output[0].length, 1);
  assert.equal(output[0][0].json.number, '+32495898698');
  assert.equal(context.requests[0].url, 'https://api.smsmobileapi.com/call/missed/list/');
});
