
# Invoice Refusal Error

The body was kept as sent and refused: why, and the agency's own visit IDs at fault when a line was the reason.

## Structure

`InvoiceRefusalError`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `string` | Required | - |
| `status` | `string` | Required, Constant | **Value**: `'refused'` |
| `reason` | [`ReasonEnum`](../../doc/models/reason-enum.md) | Required | - |
| `visits` | `string[]` | Required | - |
| `message` | `string` | Required | - |

## Example

```ts
try {
  // make the API call
} catch (error) {
  if (error instanceof InvoiceRefusalError) {
    console.log(error.result);
  }
}
```

