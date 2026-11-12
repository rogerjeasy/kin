
# Visit Report

One visit, as the agency's scheduling or visit-verification software recorded it. Kin keeps it as evidence beside its own shift; it pays nothing.

## Structure

`VisitReport`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `external_id` | `str` | Required | The agency's own ID for this visit. Sending the same ID and body again changes nothing.<br><br>**Constraints**: *Maximum Length*: `80`, *Pattern*: `^[A-Za-z0-9._:-]+$` |
| `caregiver` | `str` | Required | The aide's name as the family's circle knows them. Kin matches it to one of the circle's caregivers.<br><br>**Constraints**: *Maximum Length*: `80`, *Pattern*: `^[^<>{}\n\r]+$` |
| `kind` | [`KindEnum`](../../doc/models/kind-enum.md) | Required | What the visit was, in Kin's words for a shift.<br><br>**Constraints**: *Maximum Length*: `12` |
| `starts_at` | `datetime` | Required | When the visit was planned to begin (RFC 3339, with an offset). |
| `ends_at` | `datetime` | Required | When the visit was planned to end. |
| `checked_in_at` | `datetime` | Optional | When the aide checked in, if the agency verified it. |
| `checked_out_at` | `datetime` | Optional | When the aide checked out, if the agency verified it. Requires checkedInAt. |
| `note` | `str` | Optional | A short note from the agency. Shown to the family as the agency's words, never acted on.<br><br>**Constraints**: *Maximum Length*: `280`, *Pattern*: `^[^<>{}\n\r]+$` |

## Example

```python
import dateutil.parser

from kinapi.models.kind_enum import KindEnum
from kinapi.models.visit_report import VisitReport

visit_report = VisitReport(
    external_id='externalId4',
    caregiver='caregiver6',
    kind=KindEnum.AIDE,
    starts_at=dateutil.parser.parse('2016-03-13T12:52:32.123Z'),
    ends_at=dateutil.parser.parse('2016-03-13T12:52:32.123Z'),
    checked_in_at=dateutil.parser.parse('2016-03-13T12:52:32.123Z'),
    checked_out_at=dateutil.parser.parse('2016-03-13T12:52:32.123Z'),
    note='note6'
)
```

