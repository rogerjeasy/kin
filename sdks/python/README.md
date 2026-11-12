
# Getting Started with Kin API

## Introduction

Two ways in. A member's assistant speaks the Model Context Protocol at /api/mcp with a delegation token the member granted in Kin; it reads the verified record and may propose, never approve. A home-care agency's software reports visits at /api/v1/visits, signed with its key; a report is evidence beside the family's calendar and pays nothing. Every payment waits for a person in Kin, with a fresh multi-factor check. PayPal's own tools stay behind Kin.

How to connect: [https://mzdg4f3stk.us-east-1.awsapprunner.com/developers](https://mzdg4f3stk.us-east-1.awsapprunner.com/developers)

## Building

You must have Python `3.7+` installed on your system to install and run this SDK. This SDK package depends on other Python packages like pytest, etc. These dependencies are defined in the `requirements.txt` file that comes with the SDK. To resolve these dependencies, you can use the PIP Dependency manager. Install it by following steps at [https://pip.pypa.io/en/stable/installing/](https://pip.pypa.io/en/stable/installing/).

Python and PIP executables should be defined in your PATH. Open command prompt and type `pip --version`. This should display the version of the PIP Dependency Manager installed if your installation was successful and the paths are properly defined.

* Using command line, navigate to the directory containing the generated files (including `requirements.txt`) for the SDK.
* Run the command `pip install -r requirements.txt`. This should install all the required dependencies.

![Building SDK - Step 1](https://apidocs.io/illustration/python?workspaceFolder=Kinapi-Python&step=installDependencies)

## Installation

The following section explains how to use the kinapi library in a new project.

### 1. Open Project in an IDE

Open up a Python IDE like PyCharm. The basic workflow presented here is also applicable if you prefer using a different editor or IDE.

![Open project in PyCharm - Step 1](https://apidocs.io/illustration/python?workspaceFolder=Kinapi-Python&step=pyCharm)

Click on `Open` in PyCharm to browse to your generated SDK directory and then click `OK`.

![Open project in PyCharm - Step 2](https://apidocs.io/illustration/python?workspaceFolder=Kinapi-Python&step=openProject0)

The project files will be displayed in the side bar as follows:

![Open project in PyCharm - Step 3](https://apidocs.io/illustration/python?workspaceFolder=Kinapi-Python&projectName=kinapi&step=openProject1)

### 2. Add a new Test Project

Create a new directory by right clicking on the solution name as shown below:

![Add a new project in PyCharm - Step 1](https://apidocs.io/illustration/python?workspaceFolder=Kinapi-Python&projectName=kinapi&step=createDirectory)

Name the directory as "test".

![Add a new project in PyCharm - Step 2](https://apidocs.io/illustration/python?workspaceFolder=Kinapi-Python&step=nameDirectory)

Add a python file to this project.

![Add a new project in PyCharm - Step 3](https://apidocs.io/illustration/python?workspaceFolder=Kinapi-Python&projectName=kinapi&step=createFile)

Name it "testSDK".

![Add a new project in PyCharm - Step 4](https://apidocs.io/illustration/python?workspaceFolder=Kinapi-Python&projectName=kinapi&step=nameFile)

In your python file you will be required to import the generated python library using the following code lines

```python
from kinapi.kinapi_client import KinapiClient
```

![Add a new project in PyCharm - Step 5](https://apidocs.io/illustration/python?workspaceFolder=Kinapi-Python&projectName=kinapi&libraryName=kinapi.kinapi_client&className=KinapiClient&step=projectFiles)

After this you can write code to instantiate an API client object, get a controller object and  make API calls. Sample code is given in the subsequent sections.

### 3. Run the Test Project

To run the file within your test project, right click on your Python file inside your Test project and click on `Run`

![Run Test Project - Step 1](https://apidocs.io/illustration/python?workspaceFolder=Kinapi-Python&projectName=kinapi&libraryName=kinapi.kinapi_client&className=KinapiClient&step=runProject)

## Test the SDK

You can test the generated SDK and the server with test cases. `unittest` is used as the testing framework and `pytest` is used as the test runner. You can run the tests as follows:

Navigate to the root directory of the SDK and run the following commands


pip install -r test-requirements.txt
pytest


## Initialize the API Client

**_Note:_** Documentation for the client can be found [here.](doc/client.md)

The following parameters are configurable for the API Client:

| Parameter | Type | Description |
|  --- | --- | --- |
| http_client_instance | `Union[Session, HttpClientProvider]` | The Http Client passed from the sdk user for making requests |
| override_http_client_configuration | `bool` | The value which determines to override properties of the passed Http Client from the sdk user |
| http_call_back | `HttpCallBack` | The callback value that is invoked before and after an HTTP call is made to an endpoint |
| timeout | `float` | The value to use for connection timeout. <br> **Default: 60** |
| max_retries | `int` | The number of times to retry an endpoint call if it fails. <br> **Default: 0** |
| backoff_factor | `float` | A backoff factor to apply between attempts after the second try. <br> **Default: 2** |
| retry_statuses | `Array of int` | The http statuses on which retry is to be done. <br> **Default: [408, 413, 429, 500, 502, 503, 504, 521, 522, 524, 408, 413, 429, 500, 502, 503, 504, 521, 522, 524]** |
| retry_methods | `Array of string` | The http methods on which retry is to be done. <br> **Default: ["GET", "PUT", "GET", "PUT"]** |
| proxy_settings | [`ProxySettings`](doc/proxy-settings.md) | Optional proxy configuration to route HTTP requests through a proxy server. |
| delegation_token_credentials | [`DelegationTokenCredentials`](doc/auth/oauth-2-bearer-token.md) | The credential object for OAuth 2 Bearer token |
| agency_key_credentials | [`AgencyKeyCredentials`](doc/auth/custom-header-signature.md) | The credential object for Custom Header Signature |
| agency_signature_credentials | [`AgencySignatureCredentials`](doc/auth/custom-header-signature-1.md) | The credential object for Custom Header Signature |

The API client can be initialized as follows:

### Code-Based Client Initialization

```python
from kinapi.configuration import Environment
from kinapi.http.auth.agency_key import AgencyKeyCredentials
from kinapi.http.auth.agency_signature import AgencySignatureCredentials
from kinapi.http.auth.delegation_token import DelegationTokenCredentials
from kinapi.kinapi_client import KinapiClient

client = KinapiClient(
    delegation_token_credentials=DelegationTokenCredentials(
        access_token='AccessToken'
    ),
    agency_key_credentials=AgencyKeyCredentials(
        kin_agency_key='Kin-Agency-Key'
    ),
    agency_signature_credentials=AgencySignatureCredentials(
        kin_signature='Kin-Signature'
    ),
    environment=Environment.PRODUCTION
)
```

### Environment-Based Client Initialization

```python
from kinapi.kinapi_client import KinapiClient

# Specify the path to your .env file if it’s located outside the project’s root directory.
client = KinapiClient.from_environment(dotenv_path='/path/to/.env')
```

See the [Environment-Based Client Initialization](doc/environment-based-client-initialization.md) section for details.

## Authorization

This API uses the following authentication schemes.

* [`delegationToken (OAuth 2 Bearer token)`](doc/auth/oauth-2-bearer-token.md)
* [`agencyKey (Custom Header Signature)`](doc/auth/custom-header-signature.md)
* [`agencySignature (Custom Header Signature)`](doc/auth/custom-header-signature-1.md)

## List of APIs

* [API](doc/controllers/api.md)

## SDK Infrastructure

### Configuration

* [ProxySettings](doc/proxy-settings.md)
* [Environment-Based Client Initialization](doc/environment-based-client-initialization.md)

### HTTP

* [HttpResponse](doc/http-response.md)
* [HttpRequest](doc/http-request.md)

### Utilities

* [ApiHelper](doc/api-helper.md)
* [HttpDateTime](doc/http-date-time.md)
* [RFC3339DateTime](doc/rfc3339-date-time.md)
* [UnixDateTime](doc/unix-date-time.md)

