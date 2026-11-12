
# Custom Header Signature



Documentation for accessing and setting credentials for agencySignature.

## Auth Credentials

| Name | Type | Description | Setter |
|  --- | --- | --- | --- |
| Kin-Signature | `string` | t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>. | `kinSignature` |



**Note:** Auth credentials can be set using `agencySignatureCredentials` object in the client.

## Usage Example

### Client Initialization

You must provide credentials in the client as shown in the following code snippet.

```ts
import { Client } from 'kin-apilib';

const client = new Client({
  agencySignatureCredentials: {
    'Kin-Signature': 'Kin-Signature'
  },
});
```


