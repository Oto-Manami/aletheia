// 作品にまとめる候補を、閲覧サイトの形に直す（設計書 決定記録 0080）。候補の作り方は @aletheia/intake/titles

import type { WorkGroup } from "@aletheia/intake/titles";
import type { WorkGroupingGroup } from "./types.ts";

export function groupingGroupOf(g: WorkGroup): WorkGroupingGroup {
  return {
    key: g.key,
    name: g.name,
    work: g.work,
    subtype: g.subtype,
    events: g.events.map((e) => ({
      id: e.id,
      title: e.title,
      kind: e.kind,
      startsOn: e.starts_on,
      datePrecision: e.date_precision,
      episodeNumber: e.episode_number,
      number: e.number,
      match: e.match,
    })),
  };
}
