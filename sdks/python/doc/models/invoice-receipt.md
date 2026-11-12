
# Invoice Receipt

The invoice was kept as a bill for the family to review. It pays nothing by itself.

## Structure

`InvoiceReceipt`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `uuid\|str` | Required | - |
| `status` | `str` | Required, Constant | **Value**: `"received"` |
| `duplicate` | `bool` | Required | - |
| `note` | `str` | Required | - |

## Example

```python
from kinapi.models.invoice_receipt import InvoiceReceipt

invoice_receipt = InvoiceReceipt(
    id='6f1d1c52-5d0e-4c8e-9a35-2a7f0b8e6c11',
    duplicate=False,
    note='Kept as a bill for the family to review against the visits it confirmed.'
)
```

