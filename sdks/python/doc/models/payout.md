
# Payout

null until Kin has asked PayPal to pay.

## Structure

`Payout`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `state` | [`StateEnum`](../../doc/models/state-enum.md) | Required | - |
| `paypal_item_status` | `str` | Required, Constant | PayPal's payout item status, named only once PayPal confirmed a real payout.<br><br>**Value**: `"SUCCESS"` |
| `simulated` | `bool` | Required | A demo circle's payout, simulated and labelled so. |

## Example

```python
from kinapi.models.payout import Payout
from kinapi.models.state_enum import StateEnum

payout = Payout(
    state=StateEnum.CONFIRMED,
    simulated=False
)
```

