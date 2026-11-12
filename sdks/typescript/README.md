
# Getting Started with Kin API

## Introduction

Two ways in. A member's assistant speaks the Model Context Protocol at /api/mcp with a delegation token the member granted in Kin; it reads the verified record and may propose, never approve. A home-care agency's software reports visits at /api/v1/visits, signed with its key; a report is evidence beside the family's calendar and pays nothing. Every payment waits for a person in Kin, with a fresh multi-factor check. PayPal's own tools stay behind Kin.

How to connect: [https://mzdg4f3stk.us-east-1.awsapprunner.com/developers](https://mzdg4f3stk.us-east-1.awsapprunner.com/developers)

## Building

### Requirements

The SDK relies on **Node.js** and **npm** (to resolve dependencies). It also requires **Typescript version >=4.1**. You can download and install Node.js and [npm](https://www.npmjs.com/) from [the official Node.js website](https://nodejs.org/en/download/).

> **NOTE:** npm is installed by default when Node.js is installed.

### Verify Successful Installation

Run the following commands in the command prompt or shell of your choice to check if Node.js and npm are successfully installed:

* Node.js: `node --version`

* npm: `npm --version`

![Version Check](https://apidocs.io/illustration/typescript?workspaceFolder=KinAPI&step=versionCheck)

### Install Dependencies

- To resolve all dependencies, go to the **SDK root directory** and run the following command with npm:

```bash
npm install
```

- This will install all dependencies in the **node_modules** folder.

![Resolve Dependencies](https://apidocs.io/illustration/typescript?workspaceFolder=KinAPI&workspaceName=kin-apilib&step=resolveDependency)

## Installation

The following section explains how to use the generated library in a new project.

### 1. Initialize the Node Project

- Open an IDE/text editor for JavaScript like Visual Studio Code. The basic workflow presented here is also applicable if you prefer using a different editor or IDE.

- Click on **File** and select **Open Folder**. Select an empty folder of your project, the folder will become visible in the sidebar on the left.

![Open Folder](https://apidocs.io/illustration/typescript?step=openProject)

- To initialize the Node project, click on **Terminal** and select **New Terminal**. Execute the following command in the terminal:

```bash
npm init --y
```

![Initialize the Node Project](https://apidocs.io/illustration/typescript?step=initializeProject)

### 2. Add Dependencies to the Client Library

- The created project manages its dependencies using its `package.json` file. In order to add a dependency on the *Kin APILib* client library, double click on the `package.json` file in the bar on the left and add the dependency to the package in it.

![Add KinApilib Dependency](https://apidocs.io/illustration/typescript?workspaceFolder=KinAPI&workspaceName=kin-apilib&step=importDependency)

- To install the package in the project, run the following command in the terminal:

```bash
npm install
```

![Install KinApilib Dependency](https://apidocs.io/illustration/typescript?step=installDependency)

## Test the SDK

To validate the functionality of this SDK, you can execute all tests located in the `test` directory. This SDK utilizes `Jest` as both the testing framework and test runner.

To run the tests, navigate to the root directory of the SDK and execute the following command:

```bash
npm run test
```

Or you can also run tests with coverage report:

```bash
npm run test:coverage
```

## Initialize the API Client

**_Note:_** Documentation for the client can be found [here.](doc/client.md)

The following parameters are configurable for the API Client:

| Parameter | Type | Description |
|  --- | --- | --- |
| timeout | `number` | Timeout for API calls.<br>*Default*: `0` |
| httpClientOptions | [`Partial<HttpClientOptions>`](doc/http-client-options.md) | Stable configurable http client options. |
| unstableHttpClientOptions | `any` | Unstable configurable http client options. |
| delegationTokenCredentials | [`DelegationTokenCredentials`](doc/auth/oauth-2-bearer-token.md) | The credential object for delegationToken |
| agencyKeyCredentials | [`AgencyKeyCredentials`](doc/auth/custom-header-signature.md) | The credential object for agencyKey |
| agencySignatureCredentials | [`AgencySignatureCredentials`](doc/auth/custom-header-signature-1.md) | The credential object for agencySignature |

The API client can be initialized as follows:

### Code-Based Client Initialization

```ts
import { Client } from 'kin-apilib';

const client = new Client({
  delegationTokenCredentials: {
    accessToken: 'AccessToken'
  },
  agencyKeyCredentials: {
    'Kin-Agency-Key': 'Kin-Agency-Key'
  },
  agencySignatureCredentials: {
    'Kin-Signature': 'Kin-Signature'
  },
  timeout: 0,
});
```

### Configuration-Based Client Initialization

```ts
import * as path from 'path';
import * as fs from 'fs';
import { Client } from 'kin-apilib';

// Provide absolute path for the configuration file
const absolutePath = path.resolve('./config.json');

// Read the configuration file content
const fileContent = fs.readFileSync(absolutePath, 'utf-8');

// Initialize client from JSON configuration content
const client = Client.fromJsonConfig(fileContent);
```

See the [Configuration-Based Client Initialization](doc/configuration-based-client-initialization.md) section for details.

### Environment-Based Client Initialization

```ts
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { Client } from 'kin-apilib';

// Optional - Provide absolute path for the .env file
const absolutePath = path.resolve('./.env');

if (fs.existsSync(absolutePath)) {
  // Load environment variables from .env file
  dotenv.config({ path: absolutePath, override: true });
}

// Initialize client using environment variables
const client = Client.fromEnvironment(process.env);
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

* [HttpClientOptions](doc/http-client-options.md)
* [RetryConfiguration](doc/retry-configuration.md)
* [ProxySettings](doc/proxy-settings.md)
* [Configuration-Based Client Initialization](doc/configuration-based-client-initialization.md)
* [Environment-Based Client Initialization](doc/environment-based-client-initialization.md)

### HTTP

* [HttpRequest](doc/http-request.md)

### Utilities

* [ApiResponse](doc/api-response.md)
* [ApiError](doc/api-error.md)

