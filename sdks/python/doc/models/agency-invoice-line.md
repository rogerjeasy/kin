
# Agency Invoice Line

One visit the agency charges for. It must be a visit this agency already reported to the circle through POST /api/v1/visits.

## Structure

`AgencyInvoiceLine`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `visit_id` | `str` | Required | The externalId the agency reported the visit under.<br><br>**Constraints**: *Maximum Length*: `80`, *Pattern*: `^[A-Za-z0-9._:-]+$` |
| `minutes` | `int` | Required | The whole minutes charged for.<br><br>**Constraints**: `>= 1`, `<= 1440` |
| `amount_cents` | `int` | Required | What the line costs, in integer minor units (cents).<br><br>**Constraints**: `>= 1`, `<= 9007199254740991` |
| `currency` | `str` | Required | ISO 4217 code. Every line and the total are in the circle's currency.<br><br>**Constraints**: *Maximum Length*: `3`, *Pattern*: `^[A-Z]{3}$` |

## Example

```python
from kinapi.models.agency_invoice_line import AgencyInvoiceLine

agency_invoice_line = AgencyInvoiceLine(
    visit_id='visitId6',
    minutes=168,
    amount_cents=194,
    currency='currency8'
)
```

