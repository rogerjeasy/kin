
# Agency Invoice

An invoice for visits the agency reported. Kin keeps it as a bill for the family to review against the visits it confirmed; it pays nothing by itself.

## Structure

`AgencyInvoice`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `invoiceNumber` | `string` | Required | The agency's own invoice number. Sending the same number and body again changes nothing; another body under it is refused.<br><br>**Constraints**: *Maximum Length*: `40`, *Pattern*: `^[A-Za-z0-9][A-Za-z0-9._-]*$` |
| `periodStart` | `string` | Required | The first day the invoice covers (YYYY-MM-DD). |
| `periodEnd` | `string` | Required | The last day it covers, at most 92 days after the first. |
| `lines` | [`AgencyInvoiceLine[]`](../../doc/models/agency-invoice-line.md) | Required | The visits charged for, each at most once.<br><br>**Constraints**: *Minimum Items*: `1`, *Maximum Items*: `100` |
| `totalCents` | `number` | Required | The sum of the lines in integer minor units. Kin adds the lines up and refuses a total that differs.<br><br>**Constraints**: `>= 1`, `<= 9007199254740991` |
| `currency` | `string` | Required | ISO 4217 code: the circle's currency.<br><br>**Constraints**: *Maximum Length*: `3`, *Pattern*: `^[A-Z]{3}$` |
| `dueOn` | `string` | Required | When payment is due (YYYY-MM-DD). |
| `paypalEmail` | `string \| undefined` | Optional | Where the agency takes PayPal. Only with it can the family pay through PayPal Payouts, after review and every yes the agreement asks for.<br><br>**Constraints**: *Maximum Length*: `127`, *Pattern*: `^[^@\s<>{}]+@[^@\s<>{}]+\.[^@\s<>{}]+$` |

## Example

```ts
import { AgencyInvoice } from 'kin-apilib';

const agencyInvoice: AgencyInvoice = {
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
```

