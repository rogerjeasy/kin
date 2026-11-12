
# Custom Header Signature



Documentation for accessing and setting credentials for agencyKey.

## Auth Credentials

| Name | Type | Description | Setter |
|  --- | --- | --- | --- |
| Kin-Agency-Key | `string` | The agency key's public ID, agk_…, created by the circle's organizer. | `kinAgencyKey` |



**Note:** Auth credentials can be set using `agencyKeyCredentials` object in the client.

## Usage Example

### Client Initialization

You must provide credentials in the client as shown in the following code snippet.

```ts
import { Client } from 'kin-apilib';

const client = new Client({
  agencyKeyCredentials: {
    'Kin-Agency-Key': 'Kin-Agency-Key'
  },
});
```


