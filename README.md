# n8n-nodes-smsmobileapi

Connect your own Android mobile to [SMSMobileAPI](https://smsmobileapi.com/) and automate SMS and call activity with n8n.

## Features

| Node | Operation |
| --- | --- |
| SMSMobileAPI | Send an SMS from a connected mobile; choose a mobile and SIM port or use the automatic sender |
| SMSMobileAPI | Get received SMS from one mobile or all connected mobiles |
| SMSMobileAPI | Get missed, incoming, and outgoing call logs |
| SMSMobileAPI | List connected mobiles and inspect one mobile's status |
| SMSMobileAPI Trigger | Start a workflow for a newly synchronized SMS or missed, incoming, or outgoing call |

## Install

On a self-hosted n8n instance, open **Settings → Community nodes → Install**, enter `n8n-nodes-smsmobileapi`, and confirm. Follow your n8n administrator's policy for community nodes. Availability in n8n Cloud's built-in node search requires n8n's separate verification process.

## Credentials

1. Create an SMSMobileAPI account and connect your mobile in the [dashboard](https://dashboard.smsmobileapi.com/).
2. Copy the API key from **My API Key**.
3. In n8n, create **SMSMobileAPI** credentials and paste the key. n8n stores it as a protected credential.

The node uses HTTPS. The SMS send operation puts the key in the POST form body. The existing read endpoints require the key in the query string; avoid copying execution URLs into logs or public workflows. Do not put API keys directly in node fields.

## Actions

### Send SMS

Set the recipient in international format and the message. Optionally select a mobile and SIM 1 or SIM 2. Leaving **Mobile** empty omits `sIdentifiant`, so SMSMobileAPI selects the first available mobile. Leaving **SIM Port** empty lets the mobile select its first active SIM. The result means the message was queued; use SMSMobileAPI's sending log for its later delivery state.

### Receive SMS

Choose a mobile or leave **Mobile** empty to read received SMS from all connected mobiles. Optionally set a Unix-second timestamp or filter to messages unread in SMSMobileAPI's API state. The read action never marks messages as read.

### Call logs

Select missed, incoming, or outgoing calls. The node supports `limit` and `offset`; missed calls allow up to 500 per request, incoming and outgoing up to 200. Call synchronization must be enabled on the mobile and may be delayed by its operating system.

### Connected mobiles

List all mobiles or enter an exact mobile SID to get one status. The mobile list also populates the **Mobile** selectors in the SMS nodes.

## Triggers

The trigger periodically checks SMSMobileAPI. Choose one event type per trigger. For received SMS, select a mobile or leave it empty for all mobiles. On the first active poll, existing events establish a baseline and are not emitted. A manual test returns the newest matching event. The trigger rechecks a configurable rolling window (48 hours by default) to catch delayed synchronization and remembers up to 10,000 event identities per workflow node. It never changes API read state. It requests up to 500 recent SMS and scans at most ten call-log pages per poll. For larger histories, use SMSMobileAPI Webhook V2 to avoid gaps.

The event names are `sms.received`, `call.missed`, `call.incoming`, and `call.outgoing`.

## Example workflows

- **Missed call follow-up:** SMSMobileAPI Trigger → Event: Call Missed → SMSMobileAPI → Send SMS to the caller.
- **Route inbound SMS:** SMSMobileAPI Trigger → Event: SMS Received → CRM node. Select a mobile to keep business lines separate.
- **Fleet check:** Schedule Trigger → SMSMobileAPI → Get All Mobiles → filter offline devices → alert an operator.

## API references

- [SMS, received SMS and mobile list](https://smsmobileapi.com/doc/)
- [Missed, incoming and outgoing calls](https://smsmobileapi.com/doc-call/)
- [Webhook V2 for immediate events](https://smsmobileapi.com/webhook-v2/)

## Development

Use Node.js 24 for the n8n development CLI. Run `npm ci`, `npm run lint`, `npm run build`, and `npm test`. The package includes no runtime dependencies. Releases are published from GitHub Actions with npm provenance.

The action node uses programmatic execution because the SMS, call, and mobile endpoints have different response envelopes; it normalizes each response into individual n8n items while preserving input item links and safe error handling.

## License

MIT

