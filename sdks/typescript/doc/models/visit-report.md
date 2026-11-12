
# Visit Report

One visit, as the agency's scheduling or visit-verification software recorded it. Kin keeps it as evidence beside its own shift; it pays nothing.

## Structure

`VisitReport`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `externalId` | `string` | Required | The agency's own ID for this visit. Sending the same ID and body again changes nothing.<br><br>**Constraints**: *Maximum Length*: `80`, *Pattern*: `^[A-Za-z0-9._:-]+$` |
| `caregiver` | `string` | Required | The aide's name as the family's circle knows them. Kin matches it to one of the circle's caregivers.<br><br>**Constraints**: *Maximum Length*: `80`, *Pattern*: `^[^<>{}\n\r]+$` |
| `kind` | [`KindEnum`](../../doc/models/kind-enum.md) | Required | What the visit was, in Kin's words for a shift.<br><br>**Constraints**: *Maximum Length*: `12` |
| `startsAt` | `string` | Required | When the visit was planned to begin (RFC 3339, with an offset). |
| `endsAt` | `string` | Required | When the visit was planned to end. |
| `checkedInAt` | `string \| undefined` | Optional | When the aide checked in, if the agency verified it. |
| `checkedOutAt` | `string \| undefined` | Optional | When the aide checked out, if the agency verified it. Requires checkedInAt. |
| `note` | `string \| undefined` | Optional | A short note from the agency. Shown to the family as the agency's words, never acted on.<br><br>**Constraints**: *Maximum Length*: `280`, *Pattern*: `^[^<>{}\n\r]+$` |

## Example

```ts
import { KindEnum, VisitReport } from 'kin-apilib';

const visitReport: VisitReport = {
  externalId: 'externalId4',
  caregiver: 'caregiver6',
  kind: KindEnum.Appointment,
  startsAt: '2016-03-13T12:52:32.123Z',
  endsAt: '2016-03-13T12:52:32.123Z',
  checkedInAt: '2016-03-13T12:52:32.123Z',
  checkedOutAt: '2016-03-13T12:52:32.123Z',
  note: 'note4',
};
```

