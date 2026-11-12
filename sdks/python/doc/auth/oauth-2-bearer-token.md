
# OAuth 2 Bearer token



Documentation for accessing and setting credentials for delegationToken.

## Auth Credentials

| Name | Type | Description | Getter |
|  --- | --- | --- | --- |
| AccessToken | `str` | The OAuth 2.0 Access Token to use for API requests. | `access_token` |



**Note:** Auth credentials can be set using `DelegationTokenCredentials` object, passed in as named parameter `delegation_token_credentials` in the client initialization.

## Usage Example

### Client Initialization

You must provide credentials in the client as shown in the following code snippet.

```python
from kinapi.http.auth.delegation_token import DelegationTokenCredentials
from kinapi.kinapi_client import KinapiClient

client = KinapiClient(
    delegation_token_credentials=DelegationTokenCredentials(
        access_token='AccessToken'
    )
)
```


