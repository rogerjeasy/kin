
# Payout

null until Kin has asked PayPal to pay.

## Structure

`Payout`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `state` | [`StateEnum`](../../doc/models/state-enum.md) | Required | - |
| `paypalItemStatus` | `string` | Required, Constant | PayPal's payout item status, named only once PayPal confirmed a real payout.<br><br>**Value**: `'SUCCESS'` |
| `simulated` | `boolean` | Required | A demo circle's payout, simulated and labelled so. |

## Example

```ts
import { Payout, StateEnum } from 'kin-apilib';

const payout: Payout = {
  state: StateEnum.Confirmed,
  paypalItemStatus: 'SUCCESS',
  simulated: false,
};
```

