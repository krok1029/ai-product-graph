import type { ManagedFieldChange, PlaneManagedContentPort } from "../../application/plane-observation-ports.js";
import { planeCreateFields } from "./fields.js";
import { planeKnownItemObservation } from "./known-item-observation.js";

export const planeManagedContent: PlaneManagedContentPort = {
  compare({ expected, observed }) {
    const fields = planeCreateFields(expected);
    const item = planeKnownItemObservation(observed.content, { container: expected.container, externalId: observed.externalId });
    if (!item || item.externalUrl !== observed.externalUrl || item.externalStatus !== observed.externalStatus ||
        item.concurrencyToken !== observed.concurrencyToken) throw new Error("Invalid Plane content observation.");
    const changes: ManagedFieldChange[] = [];
    // 固定順序並保留缺漏/null 的差別；外部欄位不參與內容差異判定。
    for (const field of ["name", "description_html", "external_source", "external_id"] as const) {
      if (item.content[field] === fields[field]) continue;
      changes.push({ field, expected: fields[field], observed: Object.hasOwn(item.content, field)
        ? { present: true, value: item.content[field] as string | null } : { present: false } });
    }
    return changes;
  }
};
