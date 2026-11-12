
# Invoice Receipt

The invoice was kept as a bill for the family to review. It pays nothing by itself.

## Structure

`InvoiceReceipt`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `string` | Required | - |
| `status` | `string` | Required, Constant | **Value**: `'received'` |
| `duplicate` | `boolean` | Required | - |
| `note` | `string` | Required | - |

## Example

```ts
import { InvoiceReceipt } from 'kin-apilib';

const invoiceReceipt: InvoiceReceipt = {
  id: '6f1d1c52-5d0e-4c8e-9a35-2a7f0b8e6c11',
  status: 'received',
  duplicate: false,
  note: 'Kept as a bill for the family to review against the visits it confirmed.',
};
```

