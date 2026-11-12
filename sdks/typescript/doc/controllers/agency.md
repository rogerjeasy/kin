# Agency

A home-care agency's software: visits as evidence, invoices as bills a person reviews. Signed with the agency's key; nothing here pays.

```ts
const agencyController = new AgencyController(client);
```

## Class Name

`AgencyController`

## Methods

* [Report Visit](../../doc/controllers/agency.md#report-visit)
* [Submit Invoice](../../doc/controllers/agency.md#submit-invoice)
* [Get Invoice Status](../../doc/controllers/agency.md#get-invoice-status)


# Report Visit

Kept as evidence beside the shift on Kin's calendar. The body is signed: Kin-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the key's secret>. A timestamp more than 300 seconds from Kin's clock is refused. Sending the same externalId and body again is idempotent.

```ts
async reportVisit(
  body: VisitReport,
  requestOptions?: RequestOptions
): Promise<ApiResponse<VisitReceipt>>
```

## Authentication

This endpoint requires [agencyKey](../../doc/auth/custom-header-signature.md) **AND** [agencySignature](../../doc/auth/custom-header-signature-1.md)

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `body` | [`VisitReport`](../../doc/models/visit-report.md) | Body, Required | - |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: The same visit was already kept; nothing changed.

This method returns an [`ApiResponse`](../../doc/api-response.md) instance. The `result` property of this instance returns the response data which is of type [`VisitReceipt`](../../doc/models/visit-receipt.md).

## Example Usage

```ts
const body: VisitReport = {
  externalId: 'externalId8',
  caregiver: 'caregiver2',
  kind: KindEnum.Appointment,
  startsAt: '2016-03-13T12:52:32.123Z',
  endsAt: '2016-03-13T12:52:32.123Z',
};

try {
  const response = await agencyController.reportVisit(body);

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
    if (error instanceof CustomError) {
      console.log(error.result);
    }
  }
}
```

## Errors

| HTTP Status Code | Error Description | Exception Class |
|  --- | --- | --- |
| 401 | The key is unknown or revoked, or the signature does not match. | [`CustomError`](../../doc/models/custom-error.md) |
| 409 | This externalId was reported before with a different body. | [`CustomError`](../../doc/models/custom-error.md) |
| 413 | The body is larger than 16 KB. | [`CustomError`](../../doc/models/custom-error.md) |
| 415 | The body is not application/json. | [`CustomError`](../../doc/models/custom-error.md) |
| 422 | The body was kept as sent but is not a visit Kin can read. | [`CustomError`](../../doc/models/custom-error.md) |
| 429 | Too many visits from this key today. | [`CustomError`](../../doc/models/custom-error.md) |
| 503 | Agency reporting is not switched on in this deployment. | [`CustomError`](../../doc/models/custom-error.md) |


# Submit Invoice

Kept as a bill on the family's Bills screen, checked against the visits the family confirmed. It pays nothing by itself: a person reviews it, and only after every yes the family's agreement asks for is it paid, through PayPal Payouts to the address the family confirms (paypalEmail starts the review). Kin adds the lines up in integer minor units and refuses a total that differs. Signed exactly like a visit: Kin-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the key's secret>, within 300 seconds of Kin's clock. Sending the same invoiceNumber and body again is idempotent.

```ts
async submitInvoice(
  body: AgencyInvoice,
  requestOptions?: RequestOptions
): Promise<ApiResponse<InvoiceReceipt>>
```

## Authentication

This endpoint requires [agencyKey](../../doc/auth/custom-header-signature.md) **AND** [agencySignature](../../doc/auth/custom-header-signature-1.md)

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `body` | [`AgencyInvoice`](../../doc/models/agency-invoice.md) | Body, Required | - |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: The same invoice was already kept; nothing changed.

This method returns an [`ApiResponse`](../../doc/api-response.md) instance. The `result` property of this instance returns the response data which is of type [`InvoiceReceipt`](../../doc/models/invoice-receipt.md).

## Example Usage

```ts
const body: AgencyInvoice = {
  invoiceNumber: 'INV-1042',
  periodStart: '2026-11-01',
  periodEnd: '2026-11-30',
  lines: [
    {
      visitId: 'visit-1042',
      minutes: 240,
      amountCents: 11200,
      currency: 'USD',
    },
    {
      visitId: 'visit-1043',
      minutes: 180,
      amountCents: 8400,
      currency: 'USD',
    }
  ],
  totalCents: 19600,
  currency: 'USD',
  dueOn: '2026-12-15',
  paypalEmail: 'billing@agency.example',
};

try {
  const response = await agencyController.submitInvoice(body);

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
    if (error instanceof CustomError) {
      console.log(error.result);
    } else if (error instanceof InvoiceRefusalError) {
      console.log(error.result);
    }
  }
}
```

## Errors

| HTTP Status Code | Error Description | Exception Class |
|  --- | --- | --- |
| 401 | The key is unknown or revoked, or the signature does not match. | [`CustomError`](../../doc/models/custom-error.md) |
| 409 | This invoiceNumber was sent before with a different body. | [`CustomError`](../../doc/models/custom-error.md) |
| 413 | The body is larger than 64 KB. | [`CustomError`](../../doc/models/custom-error.md) |
| 415 | The body is not application/json. | [`CustomError`](../../doc/models/custom-error.md) |
| 422 | The body was kept as sent but refused, with why and the agency's visit IDs at fault. | [`InvoiceRefusalError`](../../doc/models/invoice-refusal-error.md) |
| 429 | Too many invoices from this key today. | [`CustomError`](../../doc/models/custom-error.md) |
| 503 | Agency reporting is not switched on in this deployment. | [`CustomError`](../../doc/models/custom-error.md) |


# Get Invoice Status

received, under_review, approved, paid or declined, with PayPal's payout item status once Kin has read it back from PayPal. Nothing about the family beyond that. Signed like a POST, with the request's path in place of the body: v1=<hex HMAC-SHA256 of "<t>./api/v1/invoices/<number>">.

```ts
async getInvoiceStatus(
  number: string,
  requestOptions?: RequestOptions
): Promise<ApiResponse<InvoiceStatus>>
```

## Authentication

This endpoint requires [agencyKey](../../doc/auth/custom-header-signature.md) **AND** [agencySignature](../../doc/auth/custom-header-signature-1.md)

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `number` | `string` | Template, Required | The agency's own invoice number, as it was sent.<br><br>**Constraints**: *Maximum Length*: `40`, *Pattern*: `^[A-Za-z0-9][A-Za-z0-9._-]*$` |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: Where the invoice stands.

This method returns an [`ApiResponse`](../../doc/api-response.md) instance. The `result` property of this instance returns the response data which is of type [`InvoiceStatus`](../../doc/models/invoice-status.md).

## Example Usage

```ts
const number = 'INV-1042';

try {
  const response = await agencyController.getInvoiceStatus(number);

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
    if (error instanceof CustomError) {
      console.log(error.result);
    }
  }
}
```

## Errors

| HTTP Status Code | Error Description | Exception Class |
|  --- | --- | --- |
| 401 | The key is unknown or revoked, or the signature does not match. | [`CustomError`](../../doc/models/custom-error.md) |
| 404 | No invoice from this key has that number. | [`CustomError`](../../doc/models/custom-error.md) |
| 503 | Agency reporting is not switched on in this deployment. | [`CustomError`](../../doc/models/custom-error.md) |

