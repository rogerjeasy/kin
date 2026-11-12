
# Custom Header Signature



Documentation for accessing and setting credentials for agencySignature.

## Auth Credentials

| Name | Type | Description | Getter |
|  --- | --- | --- | --- |
| Kin-Signature | `str` | t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>. | `kin_signature` |



**Note:** Auth credentials can be set using `AgencySignatureCredentials` object, passed in as named parameter `agency_signature_credentials` in the client initialization.

## Usage Example

### Client Initialization

You must provide credentials in the client as shown in the following code snippet.

```python
from kinapi.http.auth.agency_signature import AgencySignatureCredentials
from kinapi.kinapi_client import KinapiClient

client = KinapiClient(
    agency_signature_credentials=AgencySignatureCredentials(
        kin_signature='Kin-Signature'
    )
)
```


