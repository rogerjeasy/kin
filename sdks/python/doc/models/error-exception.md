
# Error Exception

## Structure

`ErrorException`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `error` | `str` | Required | - |
| `message` | `str` | Required | - |

## Example

```python
try:
    # make the API call
except ErrorException as e:
    print(e)
except APIException as e:
    print(e)
```

