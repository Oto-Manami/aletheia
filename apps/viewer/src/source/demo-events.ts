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
  type RefLabel,
  SourceError,
} from "./types.ts";

const WORKS = {
  radio: "b1000000-0000-4000-8000-000000000001",
  magazine: "b1000000-0000-4000-8000-000000000002",
  tv: "b1000000-0000-4000-8000-000000000003",
  hall: "b1000000-0000-4000-8000-000000000004",
} as const;

const PERFORMANCE = "e1000000-0000-4000-8000-000000000011";

type DemoEntity = EntityOption & { classification: "public" | "private"; archiveSubject?: boolean };

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

  private summary(e: EventDetail, linked: ReadonlySet<string>): EventSummary {
    const subject = e.participants.find((p) =>
      this.entities.some((x) => x.id === p.entityId && x.archiveSubject),
    );
    return {
      id: e.id,
      kind: e.kind,
      eventType: e.eventType,
      title: e.title,
      parentId: e.parentId,
      startsOn: e.startsOn,
      endsOn: e.endsOn,
      datePrecision: e.datePrecision,
      workName: e.workName,
      // 出典は、手で入れた URL か、紐付いた素材のどちらか
      hasSources: e.sources.length > 0 || linked.has(e.id),
      subjectStatus: subject?.status ?? null,
      classification: e.classification,
    };
  }

  list(
    filter: { query?: string; kind?: string; from?: string; to?: string } = {},
    linked: ReadonlySet<string> = new Set(),
  ) {
    const q = filter.query?.trim() ?? "";
    const { from, to } = filter;
    const items = this.events
      .filter((e) => !filter.kind || e.kind === filter.kind)
      .filter((e) => !to || (e.startsOn !== null && e.startsOn <= to))
      .filter((e) => !from || (e.endsOn ?? e.startsOn ?? "") >= from)
      .filter((e) => !q || e.title.includes(q) || (e.workName ?? "").includes(q))
      .sort((a, b) => (b.startsOn ?? "").localeCompare(a.startsOn ?? ""))
      .map((e) => this.summary(e, linked));
    return { items, total: this.events.length };
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
        .map((c) => ({
          id: c.id,
          kind: c.kind,
          title: c.title,
          startsOn: c.startsOn,
          datePrecision: c.datePrecision,
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

  subjects(): RefLabel[] {
    return this.entities
      .filter((e) => e.archiveSubject)
      .map((e) => ({ id: e.id, type: "entity" as const, label: e.label }));
  }
}
