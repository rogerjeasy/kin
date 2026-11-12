
# Custom Header Signature



Documentation for accessing and setting credentials for agencyKey.

## Auth Credentials

| Name | Type | Description | Getter |
|  --- | --- | --- | --- |
| Kin-Agency-Key | `str` | The agency key's public ID, agk_…, created by the circle's organizer. | `kin_agency_key` |



**Note:** Auth credentials can be set using `AgencyKeyCredentials` object, passed in as named parameter `agency_key_credentials` in the client initialization.

## Usage Example

### Client Initialization

You must provide credentials in the client as shown in the following code snippet.

```python
from kinapi.http.auth.agency_key import AgencyKeyCredentials
from kinapi.kinapi_client import KinapiClient

client = KinapiClient(
    agency_key_credentials=AgencyKeyCredentials(
        kin_agency_key='Kin-Agency-Key'
    )
)
```


