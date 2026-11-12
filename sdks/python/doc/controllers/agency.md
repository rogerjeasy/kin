# Agency

A home-care agency's software: visits as evidence, invoices as bills a person reviews. Signed with the agency's key; nothing here pays.

```python
agency_controller = client.agency
```

## Class Name

`AgencyController`

## Methods

* [Report Visit](../../doc/controllers/agency.md#report-visit)
* [Submit Invoice](../../doc/controllers/agency.md#submit-invoice)
* [Get Invoice Status](../../doc/controllers/agency.md#get-invoice-status)


# Report Visit

Kept as evidence beside the shift on Kin's calendar. The body is signed: Kin-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the key's secret>. A timestamp more than 300 seconds from Kin's clock is refused. Sending the same externalId and body again is idempotent.

```python
def report_visit(self,
                body)
```

## Authentication

This endpoint requires [agencyKey](../../doc/auth/custom-header-signature.md) **AND** [agencySignature](../../doc/auth/custom-header-signature-1.md)

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `body` | [`VisitReport`](../../doc/models/visit-report.md) | Body, Required | - |

## Response Type

**200**: The same visit was already kept; nothing changed.

[`VisitReceipt`](../../doc/models/visit-receipt.md)

## Example Usage

```python
body = VisitReport(
    external_id='externalId8',
    caregiver='caregiver2',
    kind=KindEnum.APPOINTMENT,
    starts_at=dateutil.parser.parse('2016-03-13T12:52:32.123Z'),
    ends_at=dateutil.parser.parse('2016-03-13T12:52:32.123Z')
)

result = agency_controller.report_visit(body)
print(result)
```

## Errors

| HTTP Status Code | Error Description | Exception Class |
|  --- | --- | --- |
| 401 | The key is unknown or revoked, or the signature does not match. | [`ErrorException`](../../doc/models/error-exception.md) |
| 409 | This externalId was reported before with a different body. | [`ErrorException`](../../doc/models/error-exception.md) |
| 413 | The body is larger than 16 KB. | [`ErrorException`](../../doc/models/error-exception.md) |
| 415 | The body is not application/json. | [`ErrorException`](../../doc/models/error-exception.md) |
| 422 | The body was kept as sent but is not a visit Kin can read. | [`ErrorException`](../../doc/models/error-exception.md) |
| 429 | Too many visits from this key today. | [`ErrorException`](../../doc/models/error-exception.md) |
| 503 | Agency reporting is not switched on in this deployment. | [`ErrorException`](../../doc/models/error-exception.md) |


# Submit Invoice

Kept as a bill on the family's Bills screen, checked against the visits the family confirmed. It pays nothing by itself: a person reviews it, and only after every yes the family's agreement asks for is it paid, through PayPal Payouts to the address the family confirms (paypalEmail starts the review). Kin adds the lines up in integer minor units and refuses a total that differs. Signed exactly like a visit: Kin-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the key's secret>, within 300 seconds of Kin's clock. Sending the same invoiceNumber and body again is idempotent.

```python
def submit_invoice(self,
                  body)
```

## Authentication

This endpoint requires [agencyKey](../../doc/auth/custom-header-signature.md) **AND** [agencySignature](../../doc/auth/custom-header-signature-1.md)

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `body` | [`AgencyInvoice`](../../doc/models/agency-invoice.md) | Body, Required | - |

## Response Type

**200**: The same invoice was already kept; nothing changed.

[`InvoiceReceipt`](../../doc/models/invoice-receipt.md)

## Example Usage

```python
body = AgencyInvoice(
    invoice_number='INV-1042',
    period_start=dateutil.parser.parse('2026-11-01').date(),
    period_end=dateutil.parser.parse('2026-11-30').date(),
    lines=[
        AgencyInvoiceLine(
            visit_id='visit-1042',
            minutes=240,
            amount_cents=11200,
            currency='USD'
        ),
        AgencyInvoiceLine(
            visit_id='visit-1043',
            minutes=180,
            amount_cents=8400,
            currency='USD'
        )
    ],
    total_cents=19600,
    currency='USD',
    due_on=dateutil.parser.parse('2026-12-15').date(),
    paypal_email='billing@agency.example'
)

result = agency_controller.submit_invoice(body)
print(result)
```

## Errors

| HTTP Status Code | Error Description | Exception Class |
|  --- | --- | --- |
| 401 | The key is unknown or revoked, or the signature does not match. | [`ErrorException`](../../doc/models/error-exception.md) |
| 409 | This invoiceNumber was sent before with a different body. | [`ErrorException`](../../doc/models/error-exception.md) |
| 413 | The body is larger than 64 KB. | [`ErrorException`](../../doc/models/error-exception.md) |
| 415 | The body is not application/json. | [`ErrorException`](../../doc/models/error-exception.md) |
| 422 | The body was kept as sent but refused, with why and the agency's visit IDs at fault. | [`InvoiceRefusalException`](../../doc/models/invoice-refusal-exception.md) |
| 429 | Too many invoices from this key today. | [`ErrorException`](../../doc/models/error-exception.md) |
| 503 | Agency reporting is not switched on in this deployment. | [`ErrorException`](../../doc/models/error-exception.md) |


# Get Invoice Status

received, under_review, approved, paid or declined, with PayPal's payout item status once Kin has read it back from PayPal. Nothing about the family beyond that. Signed like a POST, with the request's path in place of the body: v1=<hex HMAC-SHA256 of "<t>./api/v1/invoices/<number>">.

```python
def get_invoice_status(self,
                      number)
```

## Authentication

This endpoint requires [agencyKey](../../doc/auth/custom-header-signature.md) **AND** [agencySignature](../../doc/auth/custom-header-signature-1.md)

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `number` | `str` | Template, Required | The agency's own invoice number, as it was sent.<br><br>**Constraints**: *Maximum Length*: `40`, *Pattern*: `^[A-Za-z0-9][A-Za-z0-9._-]*$` |

## Response Type

**200**: Where the invoice stands.

[`InvoiceStatus`](../../doc/models/invoice-status.md)

## Example Usage

```python
number = 'INV-1042'

result = agency_controller.get_invoice_status(number)
print(result)
```

## Errors

| HTTP Status Code | Error Description | Exception Class |
|  --- | --- | --- |
| 401 | The key is unknown or revoked, or the signature does not match. | [`ErrorException`](../../doc/models/error-exception.md) |
| 404 | No invoice from this key has that number. | [`ErrorException`](../../doc/models/error-exception.md) |
| 503 | Agency reporting is not switched on in this deployment. | [`ErrorException`](../../doc/models/error-exception.md) |

