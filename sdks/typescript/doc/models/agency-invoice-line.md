
# Agency Invoice Line

One visit the agency charges for. It must be a visit this agency already reported to the circle through POST /api/v1/visits.

## Structure

`AgencyInvoiceLine`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `visitId` | `string` | Required | The externalId the agency reported the visit under.<br><br>**Constraints**: *Maximum Length*: `80`, *Pattern*: `^[A-Za-z0-9._:-]+$` |
| `minutes` | `number` | Required | The whole minutes charged for.<br><br>**Constraints**: `>= 1`, `<= 1440` |
| `amountCents` | `number` | Required | What the line costs, in integer minor units (cents).<br><br>**Constraints**: `>= 1`, `<= 9007199254740991` |
| `currency` | `string` | Required | ISO 4217 code. Every line and the total are in the circle's currency.<br><br>**Constraints**: *Maximum Length*: `3`, *Pattern*: `^[A-Z]{3}$` |

## Example

```ts
import { AgencyInvoiceLine } from 'kin-apilib';

const agencyInvoiceLine: AgencyInvoiceLine = {
  visitId: 'visitId0',
  minutes: 222,
  amountCents: 140,
  currency: 'currency8',
};
```

