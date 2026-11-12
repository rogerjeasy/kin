
# Invoice Refusal Exception

The body was kept as sent and refused: why, and the agency's own visit IDs at fault when a line was the reason.

## Structure

`InvoiceRefusalException`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `uuid\|str` | Required | - |
| `status` | `str` | Required, Constant | **Value**: `"refused"` |
| `reason` | [`ReasonEnum`](../../doc/models/reason-enum.md) | Required | - |
| `visits` | `List[str]` | Required | - |
| `message` | `str` | Required | - |

## Example

```python
try:
    # make the API call
except InvoiceRefusalException as e:
    print(e)
except APIException as e:
    print(e)
```

