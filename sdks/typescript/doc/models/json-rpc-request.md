
# Json Rpc Request

## Structure

`JsonRpcRequest`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `jsonrpc` | `string` | Required, Constant | **Value**: `'2.0'` |
| `id` | [`JsonRpcRequestId \| undefined`](../../doc/models/containers/json-rpc-request-id.md) | Optional | This is a container for one-of cases. |
| `method` | [`MethodEnum`](../../doc/models/method-enum.md) | Required | - |
| `params` | `unknown \| undefined` | Optional | - |

## Example

```ts
import { JsonRpcRequest, MethodEnum } from 'kin-apilib';

const jsonRpcRequest: JsonRpcRequest = {
  jsonrpc: '2.0',
  method: MethodEnum.EnumServerdiscover,
  id: 'String1',
  params: { 'key1': 'val1', 'key2': 'val2' },
};
```

