
# Agency Invoice

An invoice for visits the agency reported. Kin keeps it as a bill for the family to review against the visits it confirmed; it pays nothing by itself.

## Structure

`AgencyInvoice`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `invoice_number` | `str` | Required | The agency's own invoice number. Sending the same number and body again changes nothing; another body under it is refused.<br><br>**Constraints**: *Maximum Length*: `40`, *Pattern*: `^[A-Za-z0-9][A-Za-z0-9._-]*$` |
| `period_start` | `date` | Required | The first day the invoice covers (YYYY-MM-DD). |
| `period_end` | `date` | Required | The last day it covers, at most 92 days after the first. |
| `lines` | [`List[AgencyInvoiceLine]`](../../doc/models/agency-invoice-line.md) | Required | The visits charged for, each at most once.<br><br>**Constraints**: *Minimum Items*: `1`, *Maximum Items*: `100` |
| `total_cents` | `int` | Required | The sum of the lines in integer minor units. Kin adds the lines up and refuses a total that differs.<br><br>**Constraints**: `>= 1`, `<= 9007199254740991` |
| `currency` | `str` | Required | ISO 4217 code: the circle's currency.<br><br>**Constraints**: *Maximum Length*: `3`, *Pattern*: `^[A-Z]{3}$` |
| `due_on` | `date` | Required | When payment is due (YYYY-MM-DD). |
| `paypal_email` | `str` | Optional | Where the agency takes PayPal. Only with it can the family pay through PayPal Payouts, after review and every yes the agreement asks for.<br><br>**Constraints**: *Maximum Length*: `127`, *Pattern*: `^[^@\s<>{}]+@[^@\s<>{}]+\.[^@\s<>{}]+$` |

## Example

```python
import dateutil.parser

from kinapi.models.agency_invoice import AgencyInvoice
from kinapi.models.agency_invoice_line import AgencyInvoiceLine

agency_invoice = AgencyInvoice(
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
```

