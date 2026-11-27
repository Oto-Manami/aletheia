// デモ版の出来事と作品・相手（架空）。出来事の画面の確認用
//
// 人物・作品・会場はすべて架空のもの。実在の人物・媒体とは関係ない。

import { EVENTS, PEOPLE } from "./demo-data.ts";
import {
  type EntityOption,
  type EventMaterial,
  type EventDetail,
  type EventInput,
  type EventSummary,
  type NewEntity,
  type ParticipantStatus,
  type ParticipationCheck,
  type ParticipationCheckEvent,
  type PersonEvent,
  type RefLabel,
  SourceError,
  type WorkSummary,
  type WorkView,
} from "./types.ts";
import { matchesEventQuery } from "./event-relevance.ts";
import { defaultSubjectRole } from "./participation.ts";
import { type EpisodeRow, episodeKindOf, regularRoleOf, regularStatusOf } from "./regular.ts";

const WORKS = {
  radio: "b1000000-0000-4000-8000-000000000001",
  magazine: "b1000000-0000-4000-8000-000000000002",
  tv: "b1000000-0000-4000-8000-000000000003",
  hall: "b1000000-0000-4000-8000-000000000004",
} as const;

const PERFORMANCE = "e1000000-0000-4000-8000-000000000011";

/** 日程になる親の種類（設計書 決定記録 0034） */
const SCHEDULE_PARENT_KINDS: readonly string[] = ["live", "meet_greet", "event"];

type DemoEntity = EntityOption & {
  classification: "public" | "private";
  archiveSubject?: boolean;
  /** レギュラーの印（作品。決定記録 0071） */
  regular?: boolean;
};

/** 楽曲の画面で扱う種類（作品の一覧に出さない。決定記録 0066） */
const MUSIC_SUBTYPES: readonly string[] = ["song", "single", "album", "music_video"];

function demoEntities(): DemoEntity[] {
  const person = (id: string, label: string, archiveSubject = false): DemoEntity => ({
    id,
    type: "person",
    subtype: "member",
    label,
    classification: "public",
    ...(archiveSubject ? { archiveSubject } : {}),
  });
  return [
    person(PEOPLE.hanako, "試験 花子", true),
    person(PEOPLE.sakura, "見本 さくら"),
    person(PEOPLE.yui, "仮名 ゆい"),
    {
      id: WORKS.radio,
      type: "work",
      subtype: "radio_program",
      label: "仮の時間",
      classification: "public",
    },
    {
      id: WORKS.magazine,
      type: "work",
      subtype: "magazine",
      label: "月刊ミホン",
      classification: "public",
    },
    {
      id: WORKS.tv,
      type: "work",
      subtype: "tv_program",
      label: "ミホン音楽祭",
      classification: "public",
    },
    {
      id: WORKS.hall,
      type: "place",
      subtype: "venue",
      label: "架空ホール",
      classification: "public",
    },
  ];
}

const stamp = "2026-11-01T10:00:00+09:00";

function event(
  partial: Partial<EventDetail> & Pick<EventDetail, "id" | "kind" | "title">,
): EventDetail {
  return {
    eventType: null,
    parentId: null,
    parentTitle: null,
    parentKind: null,
    part: null,
    workId: null,
    workName: null,
    venueId: null,
    venueName: null,
    episodeNumber: null,
    startsOn: null,
    endsOn: null,
    datePrecision: null,
    startsAt: null,
    endsAt: null,
    sources: [],
    classification: "public",
    participants: [],
    children: [],
    createdAt: stamp,
    updatedAt: stamp,
    createdByName: "デモの運営者",
    updatedByName: "デモの運営者",
    canDelete: true,
    usage: { links: 0, drafts: 0, children: 0 },
    materials: [],
    items: [],
    ...partial,
  };
}

const hanako = (status: EventDetail["participants"][number]["status"], role = "performer") => ({
  entityId: PEOPLE.hanako,
  entityName: "試験 花子",
  role,
  status,
  characterName: null,
});

function demoEvents(): EventDetail[] {
  return [
    event({
      id: EVENTS.radio,
      kind: "episode",
      title: "ラジオ「仮の時間」第 12 回",
      workId: WORKS.radio,
      workName: "仮の時間",
      episodeNumber: 12,
      startsOn: "2026-10-12",
      datePrecision: "day",
      startsAt: "2026-10-12T21:00:00+09:00",
      sources: [{ url: "https://example.com/news/radio-12" }],
      participants: [hanako("appeared", "guest")],
    }),
    event({
      id: EVENTS.magazine,
      kind: "publication",
      title: "『月刊ミホン』12 月号",
      workId: WORKS.magazine,
      workName: "月刊ミホン",
      startsOn: "2026-11-20",
      datePrecision: "day",
      participants: [hanako("scheduled", "gravure")],
    }),
    event({
      id: EVENTS.live,
      kind: "live",
      title: "冬の試験公演（架空ホール）",
      startsOn: "2026-12-01",
      endsOn: "2026-12-02",
      datePrecision: "day",
      venueId: WORKS.hall,
      venueName: "架空ホール",
      sources: [{ url: "https://example.com/news/winter-live" }],
      participants: [hanako("scheduled")],
    }),
    event({
      id: PERFORMANCE,
      kind: "performance",
      title: "冬の試験公演 1 日目",
      parentId: EVENTS.live,
      parentTitle: "冬の試験公演（架空ホール）",
      parentKind: "live",
      startsOn: "2026-12-01",
      datePrecision: "day",
      venueId: WORKS.hall,
      venueName: "架空ホール",
      participants: [hanako("scheduled")],
    }),
    event({
      id: EVENTS.tv,
      kind: "episode",
      title: "「ミホン音楽祭 2026」（架空）",
      workId: WORKS.tv,
      workName: "ミホン音楽祭",
      startsOn: "2026-09-01",
      datePrecision: "month",
      sources: [{ url: "https://example.com/news/music-fes" }],
      participants: [hanako("not_appearing")],
    }),
    event({
      id: EVENTS.announcement,
      kind: "announcement",
      title: "見本グループ 冬のツアーの発表",
      startsOn: "2026-10-30",
      datePrecision: "day",
      sources: [{ url: "https://example.com/news/winter-tour" }],
    }),
  ];
}

/** デモ版の出来事の置き場（画面の中だけで変わる） */
export class DemoEvents {
  private entities = demoEntities();
  private events = demoEvents();
  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-0000-4000-8000-${String(this.seq).padStart(12, "0")}`;
  }

  /** 蓄積対象の人物の出演の状態 */
  private subjectStatus(e: EventDetail) {
    return (
      e.participants.find((p) => this.entities.some((x) => x.id === p.entityId && x.archiveSubject))
        ?.status ?? null
    );
  }

  /** 日程か（親がライブ・ミーグリ・イベントで、自分は番組の回でない。決定記録 0034） */
  private isSchedule(e: EventDetail): boolean {
    if (!e.parentId || e.kind === "episode") return false;
    const parent = this.events.find((x) => x.id === e.parentId);
    return parent !== undefined && SCHEDULE_PARENT_KINDS.includes(parent.kind);
  }

  private summary(e: EventDetail, linked: ReadonlySet<string>): EventSummary {
    return {
      id: e.id,
      kind: e.kind,
      eventType: e.eventType,
      title: e.title,
      parentId: e.parentId,
      parentTitle: e.parentTitle,
      part: e.part,
      scheduleCount: SCHEDULE_PARENT_KINDS.includes(e.kind)
        ? this.events.filter((c) => c.parentId === e.id && c.kind !== "episode").length
        : 0,
      startsOn: e.startsOn,
      endsOn: e.endsOn,
      datePrecision: e.datePrecision,
      workName: e.workName,
      episodeNumber: e.episodeNumber,
      // 出典は、手で入れた URL か、紐付いた素材のどちらか
      hasSources: e.sources.length > 0 || linked.has(e.id),
      subjectStatus: this.subjectStatus(e),
      classification: e.classification,
    };
  }

  list(
    filter: {
      query?: string;
      kind?: string;
      from?: string;
      to?: string;
      schedule?: "hide" | "include";
      regular?: "hide" | "include";
    } = {},
    linked: ReadonlySet<string> = new Set(),
  ) {
    const q = filter.query?.trim() ?? "";
    const { from, to } = filter;
    const regularIds = new Set(this.entities.filter((e) => e.regular).map((e) => e.id));
    const items = this.events
      .filter((e) => !filter.kind || e.kind === filter.kind)
      .filter((e) => filter.schedule !== "hide" || !this.isSchedule(e))
      .filter((e) => filter.regular !== "hide" || !e.workId || !regularIds.has(e.workId))
      .filter((e) => !to || (e.startsOn !== null && e.startsOn <= to))
      .filter((e) => !from || (e.endsOn ?? e.startsOn ?? "") >= from)
      .filter((e) => !q || matchesEventQuery(e, q))
      .sort((a, b) => (b.startsOn ?? "").localeCompare(a.startsOn ?? ""))
      .map((e) => this.summary(e, linked));
    const total =
      filter.schedule === "hide"
        ? this.events.filter((e) => !this.isSchedule(e)).length
        : this.events.length;
    return { items, total };
  }

  get(id: string, materials: EventMaterial[] = []): EventDetail {
    const linked = materials.length;
    const e = this.events.find((x) => x.id === id);
    if (!e) throw new SourceError("見つかりません", 404);
    const children = this.events.filter((c) => c.parentId === id).length;
    return {
      ...e,
      usage: { links: linked, drafts: 0, children },
      materials,
      // デモ版の閲覧者は運営者なので、何も紐付いていなければ消せる
      canDelete: linked === 0 && children === 0,
      children: this.events
        .filter((c) => c.parentId === id)
        .sort((a, b) => (a.startsOn ?? "").localeCompare(b.startsOn ?? ""))
        .map((c) => ({
          id: c.id,
          kind: c.kind,
          title: c.title,
          startsOn: c.startsOn,
          endsOn: c.endsOn,
          startsAt: c.startsAt,
          datePrecision: c.datePrecision,
          venueName: c.venueName,
          part: c.part,
          subjectStatus: this.subjectStatus(c),
        })),
    };
  }

  private nameOf(id: string | null): string | null {
    return id ? (this.entities.find((x) => x.id === id)?.label ?? null) : null;
  }

  save(id: string | null, input: EventInput): string {
    if (!input.title.trim()) throw new SourceError("題名を入れてください", 400);
    if (input.parentId && input.parentId === id) {
      throw new SourceError("親の出来事に、自分か自分の下の出来事は選べません", 400);
    }
    const current = id ? this.events.find((x) => x.id === id) : undefined;
    const now = new Date().toISOString();
    if (id && !current) throw new SourceError("見つかりません", 404);
    const next = event({
      ...(current ?? {}),
      id: id ?? this.nextId("e2000000"),
      kind: input.kind,
      eventType: input.kind === "event" ? input.eventType : null,
      title: input.title.trim(),
      parentId: input.parentId,
      parentTitle: input.parentId
        ? (this.events.find((x) => x.id === input.parentId)?.title ?? null)
        : null,
      parentKind: input.parentId
        ? (this.events.find((x) => x.id === input.parentId)?.kind ?? null)
        : null,
      part: input.part?.trim() || null,
      items: input.items
        ? input.items.map((i) => {
            const before = current?.items.find((x) => x.id === i.id);
            return {
              id: i.id ?? this.nextId("e3000000"),
              itemType: i.itemType,
              workId: i.workId,
              workName: this.nameOf(i.workId),
              title: i.title,
              note: i.note,
              linked: before?.linked ?? false,
            };
          })
        : (current?.items ?? []),
      workId: input.workId,
      workName: this.nameOf(input.workId),
      venueId: input.venueId,
      venueName: this.nameOf(input.venueId),
      episodeNumber: input.episodeNumber,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      datePrecision: input.startsOn ? (input.datePrecision ?? "day") : null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      sources: input.sources,
      classification: input.classification,
      participants: input.participants.map((p) => ({
        ...p,
        entityName: this.nameOf(p.entityId) ?? "（見つからない人物）",
      })),
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      createdByName: current?.createdByName ?? "デモの運営者",
      updatedByName: "デモの運営者",
    });
    this.events = current
      ? this.events.map((x) => (x.id === next.id ? next : x))
      : [...this.events, next];
    return next.id;
  }

  remove(id: string, linked: number): void {
    if (!this.events.some((x) => x.id === id)) throw new SourceError("見つかりません", 404);
    if (linked > 0) {
      throw new SourceError(
        `素材が ${linked} 件紐付いているため消せません。先に紐付けを外してください`,
        409,
      );
    }
    const children = this.events.filter((x) => x.parentId === id).length;
    if (children > 0) throw new SourceError(`下の出来事が ${children} 件あるため消せません`, 409);
    this.events = this.events.filter((x) => x.id !== id);
  }

  find(query: string, types: readonly string[]): EntityOption[] {
    const q = query.trim();
    if (!q) return [];
    return this.entities
      .filter((e) => types.includes(e.type) && e.label.includes(q))
      .map(({ id, type, subtype, label }) => ({ id, type, subtype, label }));
  }

  create(entity: NewEntity): EntityOption & { created: boolean } {
    const name = entity.name.trim();
    if (!name) throw new SourceError("名前を入れてください", 400);
    const key = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");
    const existing = this.entities.find(
      (e) => e.type === entity.type && key(e.label) === key(name),
    );
    if (existing) {
      const { id, type, subtype, label } = existing;
      return { id, type, subtype, label, created: false };
    }
    const created: DemoEntity = {
      id: this.nextId("b2000000"),
      type: entity.type,
      subtype: entity.subtype,
      label: name,
      classification: entity.classification,
    };
    this.entities.push(created);
    return {
      id: created.id,
      type: created.type,
      subtype: created.subtype,
      label: name,
      created: true,
    };
  }

  /** ダッシュボードの件数（決定記録 0063） */
  stats(): {
    events: { kind: string; count: number }[];
    schedules: number;
    people: number;
    songs: number;
  } {
    const kinds = new Map<string, number>();
    let schedules = 0;
    for (const e of this.events) {
      if (e.parentId) schedules++;
      else kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
    }
    return {
      events: [...kinds].map(([kind, count]) => ({ kind, count })),
      schedules,
      people: this.entities.filter((e) => e.type === "person").length,
      songs: this.entities.filter((e) => e.type === "work" && e.subtype === "song").length,
    };
  }

  /** 作品の一覧（決定記録 0065）。デモ版では素材を数えない */
  works(filter: { subtype?: string; query?: string } = {}): WorkSummary[] {
    const q = filter.query?.trim() ?? "";
    return this.entities
      .filter((e) => e.type === "work" && !MUSIC_SUBTYPES.includes(e.subtype ?? ""))
      .filter((e) => !filter.subtype || e.subtype === filter.subtype)
      .filter((e) => !q || e.label.includes(q))
      .map((w) => {
        const events = this.events.filter((e) => e.workId === w.id);
        const latest = events
          .map((e) => e.startsOn)
          .filter((d): d is string => d !== null)
          .sort()
          .at(-1);
        return {
          id: w.id,
          name: w.label,
          subtype: w.subtype,
          regular: w.regular === true,
          events: events.length,
          latest: latest ?? null,
          materials: 0,
        };
      });
  }

  /** 作品の画面（決定記録 0065）。デモ版では画像を出さない */
  work(id: string): WorkView {
    const w = this.entities.find((e) => e.id === id && e.type === "work");
    if (!w) throw new SourceError("作品が見つかりません", 404);
    const subject = this.entities.find((e) => e.archiveSubject);
    return {
      work: {
        id: w.id,
        name: w.label,
        subtype: w.subtype,
        reading: null,
        regular: w.regular === true,
      },
      subject: subject ? { id: subject.id, name: subject.label } : null,
      events: this.events
        .filter((e) => e.workId === id)
        .sort(
          (a, b) =>
            (b.startsOn ?? "").localeCompare(a.startsOn ?? "") ||
            (b.episodeNumber ?? -1) - (a.episodeNumber ?? -1),
        )
        .map((e) => ({
          id: e.id,
          title: e.title,
          kind: e.kind,
          startsOn: e.startsOn,
          datePrecision: e.datePrecision,
          episodeNumber: e.episodeNumber,
          parentId: e.parentId,
          subjectStatus: this.subjectStatus(e),
          materials: 0,
        })),
      images: [],
      moreImages: false,
    };
  }

  /** レギュラーの印（決定記録 0071） */
  setRegular(id: string, regular: boolean): void {
    const w = this.entities.find((e) => e.id === id && e.type === "work");
    if (!w) throw new SourceError("作品が見つかりません", 404);
    w.regular = regular;
  }

  /** 回・号をまとめて作る（決定記録 0072）。API と同じく、同じ回の番号・日付は飛ばす */
  addEpisodes(id: string, rows: readonly EpisodeRow[], dryRun: boolean) {
    const w = this.entities.find((e) => e.id === id && e.type === "work");
    if (!w) throw new SourceError("作品が見つかりません", 404);
    const kind = episodeKindOf(w.subtype);
    const existing = this.events.filter((e) => e.workId === id);
    const numbers = new Set(
      existing.flatMap((e) => (e.episodeNumber === null ? [] : [e.episodeNumber])),
    );
    const dates = new Set(
      existing.flatMap((e) => (e.episodeNumber === null && e.startsOn ? [e.startsOn] : [])),
    );
    const subjects = this.subjects();
    const created: { index: number; id: string | null; title: string }[] = [];
    const skipped: { index: number; reason: string }[] = [];
    for (const [index, row] of rows.entries()) {
      const number = row.number ?? null;
      const date = row.date ?? null;
      if (number !== null ? numbers.has(number) : date !== null && dates.has(date)) {
        skipped.push({
          index,
          reason: number !== null ? `#${number} は既にあります` : `${date} の回は既にあります`,
        });
        continue;
      }
      if (number !== null) numbers.add(number);
      else if (date !== null) dates.add(date);
      const title = row.title || (number === null ? w.label : `${w.label} #${number}`);
      const eventId = dryRun
        ? null
        : this.save(null, {
            kind,
            eventType: null,
            title,
            parentId: null,
            workId: id,
            venueId: null,
            episodeNumber: number,
            startsOn: date,
            endsOn: null,
            datePrecision: date ? "day" : null,
            startsAt: null,
            endsAt: null,
            sources: [],
            classification: "public",
            participants: (row.status === "unknown" ? [] : subjects).map((s) => ({
              entityId: s.id,
              role: row.role ?? regularRoleOf(kind),
              status: row.status && row.status !== "unknown" ? row.status : regularStatusOf(date),
              characterName: null,
            })),
          });
      created.push({ index, id: eventId, title });
    }
    return { created, skipped };
  }

  /** 本人の出演の確認（決定記録 0080） */
  participationCheck(today: string): ParticipationCheck {
    const subject = this.entities.find((x) => x.archiveSubject);
    if (!subject)
      return { subject: null, overdue: [], missing: [], counts: { overdue: 0, missing: 0 } };
    const row = (e: EventDetail): ParticipationCheckEvent => {
      const p = e.participants.find((x) => x.entityId === subject.id);
      const parent = e.parentId ? this.events.find((x) => x.id === e.parentId) : undefined;
      const work = e.workId ? this.entities.find((x) => x.id === e.workId) : undefined;
      return {
        id: e.id,
        title: e.title,
        kind: e.kind,
        startsOn: e.startsOn,
        endsOn: e.endsOn,
        datePrecision: e.datePrecision,
        parentTitle: parent?.title ?? null,
        workName: work?.label ?? null,
        regular: work?.regular === true,
        role: p?.role ?? defaultSubjectRole(e.kind),
        status: p?.status ?? null,
      };
    };
    const byDate = (a: EventDetail, b: EventDetail) =>
      (b.startsOn ?? "").localeCompare(a.startsOn ?? "");
    const overdue = this.events
      .filter((e) =>
        e.participants.some((p) => p.entityId === subject.id && p.status === "scheduled"),
      )
      .filter((e) => (e.endsOn ?? e.startsOn ?? "9999") < today)
      .sort(byDate)
      .map(row);
    const missing = this.events
      .filter((e) => !this.isSchedule(e) && !e.participants.some((p) => p.entityId === subject.id))
      .sort(byDate)
      .map(row);
    return {
      subject: { id: subject.id, name: subject.label },
      overdue,
      missing,
      counts: { overdue: overdue.length, missing: missing.length },
    };
  }

  /** 本人の出演の状態を付ける（決定記録 0080） */
  setSubjectParticipation(eventId: string, status: ParticipantStatus, role?: string): void {
    const subject = this.entities.find((x) => x.archiveSubject);
    const event = this.events.find((e) => e.id === eventId);
    if (!subject || !event) throw new Error("出来事が見つかりません");
    const rows = event.participants.filter((p) => p.entityId === subject.id);
    if (rows.length > 0) {
      for (const p of rows) p.status = status;
      return;
    }
    event.participants.push({
      entityId: subject.id,
      entityName: subject.label,
      role: role ?? defaultSubjectRole(event.kind),
      status,
      characterName: null,
    });
  }

  /** 人物の出演（人物の画面。決定記録 0079） */
  participationOf(entityId: string): PersonEvent[] {
    return this.events.flatMap((e) =>
      e.participants
        .filter((p) => p.entityId === entityId)
        .map((p) => {
          const work = e.workId ? this.entities.find((x) => x.id === e.workId) : undefined;
          return {
            id: e.id,
            title: e.title,
            kind: e.kind,
            startsOn: e.startsOn,
            endsOn: e.endsOn,
            datePrecision: e.datePrecision,
            episodeNumber: e.episodeNumber,
            parentId: e.parentId,
            work: work ? { id: work.id, name: work.label, regular: work.regular === true } : null,
            role: p.role,
            status: p.status,
            characterName: p.characterName,
          };
        }),
    );
  }

  subjects(): RefLabel[] {
    return this.entities
      .filter((e) => e.archiveSubject)
      .map((e) => ({ id: e.id, type: "entity" as const, label: e.label }));
  }
}
