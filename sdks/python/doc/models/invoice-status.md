
# Invoice Status

Where an invoice stands, and nothing else about the family.

## Structure

`InvoiceStatus`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `invoice_number` | `str` | Required | - |
| `status` | [`StatusEnum`](../../doc/models/status-enum.md) | Required | - |
| `total_cents` | `int` | Required | - |
| `currency` | `str` | Required | - |
| `received_at` | `datetime` | Required | - |
| `payout` | [`Payout`](../../doc/models/payout.md) | Required | null until Kin has asked PayPal to pay. |

## Example

```python
import dateutil.parser

from kinapi.models.invoice_status import InvoiceStatus
from kinapi.models.payout import Payout
from kinapi.models.state_enum import StateEnum
from kinapi.models.status_enum import StatusEnum

invoice_status = InvoiceStatus(
    invoice_number='INV-1042',
    status=StatusEnum.PAID,
    total_cents=19600,
    currency='USD',
    received_at=dateutil.parser.parse('2026-12-01T15:04:05.000Z'),
    payout=Payout(
        state=StateEnum.CONFIRMED,
        simulated=False
    )
)
```

