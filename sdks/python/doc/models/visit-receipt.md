
# Visit Receipt

## Structure

`VisitReceipt`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `uuid\|str` | Required | - |
| `status` | `str` | Required, Constant | **Value**: `"received"` |
| `duplicate` | `bool` | Required | - |
| `caregiver_matched` | `bool` | Required | - |
| `note` | `str` | Required | - |

## Example

```python
from kinapi.models.visit_receipt import VisitReceipt

visit_receipt = VisitReceipt(
    id='00001d54-0000-0000-0000-000000000000',
    duplicate=False,
    caregiver_matched=False,
    note='note4'
)
```

