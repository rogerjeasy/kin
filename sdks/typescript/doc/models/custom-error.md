
# Custom Error

## Structure

`CustomError`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `error` | `string` | Required | - |
| `message` | `string` | Required | - |

## Example

```ts
try {
  // make the API call
} catch (error) {
  if (error instanceof CustomError) {
    console.log(error.result);
  }
}
```

