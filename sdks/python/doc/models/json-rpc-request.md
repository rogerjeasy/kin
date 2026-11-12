
# Json Rpc Request

## Structure

`JsonRpcRequest`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `jsonrpc` | `str` | Required, Constant | **Value**: `"2.0"` |
| `id` | str \| int \| None | Optional | This is a container for one-of cases. |
| `method` | [`MethodEnum`](../../doc/models/method-enum.md) | Required | - |
| `params` | `Any` | Optional | - |

## Example

```python
import jsonpickle

from kinapi.models.json_rpc_request import JsonRpcRequest
from kinapi.models.method_enum import MethodEnum

json_rpc_request = JsonRpcRequest(
    method=MethodEnum.ENUM_SERVERDISCOVER,
    id='String1',
    params=jsonpickle.decode('{"key1":"val1","key2":"val2"}')
)
```

