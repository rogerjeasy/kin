
# Invoice Status

Where an invoice stands, and nothing else about the family.

## Structure

`InvoiceStatus`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `invoiceNumber` | `string` | Required | - |
| `status` | [`StatusEnum`](../../doc/models/status-enum.md) | Required | - |
| `totalCents` | `number` | Required | - |
| `currency` | `string` | Required | - |
| `receivedAt` | `string` | Required | - |
| `payout` | [`Payout \| null`](../../doc/models/payout.md) | Required | null until Kin has asked PayPal to pay. |

## Example

```ts
import { InvoiceStatus, StateEnum, StatusEnum } from 'kin-apilib';

const invoiceStatus: InvoiceStatus = {
  invoiceNumber: 'INV-1042',
  status: StatusEnum.Paid,
  totalCents: 19600,
  currency: 'USD',
  receivedAt: '2026-12-01T15:04:05.000Z',
  payout: {
    state: StateEnum.Confirmed,
    paypalItemStatus: 'SUCCESS',
    simulated: false,
  },
};
```

