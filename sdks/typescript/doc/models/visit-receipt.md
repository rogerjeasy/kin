
# Visit Receipt

## Structure

`VisitReceipt`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `string` | Required | - |
| `status` | `string` | Required, Constant | **Value**: `'received'` |
| `duplicate` | `boolean` | Required | - |
| `caregiverMatched` | `boolean` | Required | - |
| `note` | `string` | Required | - |

## Example

```ts
import { VisitReceipt } from 'kin-apilib';

const visitReceipt: VisitReceipt = {
  id: '00000730-0000-0000-0000-000000000000',
  status: 'received',
  duplicate: false,
  caregiverMatched: false,
  note: 'note6',
};
```

