// 作品にまとめる（設計書 決定記録 0080）
//
// 作品を指していない番組の回・掲載（号）を、番組・雑誌ごとにまとめて作品に付ける。候補は規則で作る:
// - 題名から号・回の印を外した名前が、既にある作品の名前・別名と同じもの（初めから選ぶ）
// - 題名に既にある作品の名前を含むもの（初めは選ばない。告知・発売なども含む）
// - 既にある作品に合わない回・号は、同じ名前どうしをまとめ、その名前で作品を作って付けられる
// 付けると作品の画面に回・号として並ぶ。付け替え（別の作品に変える）は、これまでどおり出来事の画面で行う。

import { CheckCircle2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Link } from "react-router";
import { ClassificationChoice } from "../components/EntityPicker.tsx";
import { useApp } from "../context.tsx";
import { ENTITY_SUBTYPE_LABELS, EVENT_KIND_SHORT, eventDateLabel } from "../format.ts";
import type {
  Classification,
  GroupingWorkOption,
  WorkGrouping,
  WorkGroupingEvent,
  WorkGroupingGroup,
} from "../source/types.ts";
import { useLoad } from "../use-load.ts";
import { useLayout } from "./Layout.tsx";

const nf = new Intl.NumberFormat("ja-JP");

/** 作品を作るときに選べる種類（楽曲・シングルなどは楽曲の画面で扱う。決定記録 0066） */
const MUSIC = new Set(["song", "single", "album", "music_video"]);
const WORK_SUBTYPES = Object.entries(ENTITY_SUBTYPE_LABELS["work"] ?? {}).filter(
  ([k]) => !MUSIC.has(k),
);

/** 付け先の「新しく作る」 */
const NEW = "__new__";

const PUBLICATION_SUBTYPES = new Set(["magazine", "series", "book", "photobook"]);

/** 回・号の種類と作品の種類を組み合わせてよいか（@aletheia/intake/titles の fitsWork と同じ） */
const fits = (kind: string | undefined, subtype: string | null) =>
  kind === "publication"
    ? PUBLICATION_SUBTYPES.has(subtype ?? "")
    : kind === "episode"
      ? !PUBLICATION_SUBTYPES.has(subtype ?? "")
      : true;

const workLabel = (w: GroupingWorkOption) =>
  `${w.name}（${ENTITY_SUBTYPE_LABELS["work"]?.[w.subtype ?? ""] ?? "種類なし"}${w.regular ? "・レギュラー" : ""}）`;

/** 付け先を選んで付ける欄（既にある作品か、名前と種類で作る作品） */
function AttachControls({
  kind,
  works,
  initialTarget,
  name,
  onName,
  initialSubtype,
  selectedIds,
  label,
  onDone,
}: {
  /** 回・号の種類（付け先の作品を、種類に合うものに絞る） */
  kind: string | undefined;
  works: GroupingWorkOption[];
  initialTarget: string;
  /** 作品を作るときの名前（親が持つ。選んだ行に合わせて変わる） */
  name: string;
  onName: (name: string) => void;
  initialSubtype: string | null;
  selectedIds: string[];
  label: string;
  onDone: (message: string) => void;
}) {
  const { source } = useApp();
  const id = useId();
  const [target, setTarget] = useState(initialTarget);
  const [subtype, setSubtype] = useState(initialSubtype ?? "");
  // 作る作品の公開区分は、既定を置かずに選んでもらう
  const [classification, setClassification] = useState<Classification | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 回・号の種類に合う作品だけを付け先に出す（掲載は雑誌など、番組の回はそれ以外）
  const options = useMemo(() => works.filter((w) => fits(kind, w.subtype)), [works, kind]);
  const subtypes = WORK_SUBTYPES.filter(([k]) => fits(kind, k));
  const creating = target === NEW;
  const ready =
    selectedIds.length > 0 &&
    (!creating || (name.trim() !== "" && subtype !== "" && classification !== null));

  const attach = () => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const work =
          creating && classification
            ? await source.createEntity({
                type: "work",
                subtype,
                name: name.trim(),
                classification,
              })
            : null;
        const workId = work?.id ?? target;
        const workName = work?.label ?? works.find((w) => w.id === target)?.name ?? name.trim();
        const r = await source.attachToWork(workId, selectedIds);
        setBusy(false);
        onDone(
          `「${workName}」に ${nf.format(r.attached)} 件を付けました` +
            (r.skipped > 0
              ? `（${nf.format(r.skipped)} 件は既に作品を指していたので飛ばしました）`
              : ""),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      }
    })();
  };

  // どの作品の回・号でもないもの（ほかの番組の話をしている動画など）に印を付ける（決定記録 0082）
  const skip = () => {
    setBusy(true);
    setError(null);
    source
      .setNoWork(selectedIds, true)
      .then((r) => {
        setBusy(false);
        onDone(`${nf.format(r.changed)} 件を「作品にまとめない」にしました`);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      });
  };

  return (
    <div className="grouping-actions" role="group" aria-label={label}>
      <div className="field">
        <label htmlFor={`${id}-target`}>付け先</label>
        <select
          id={`${id}-target`}
          value={target}
          disabled={busy}
          onChange={(e) => setTarget(e.target.value)}
        >
          <option value={NEW}>新しく作る</option>
          {options.map((w) => (
            <option key={w.id} value={w.id}>
              {workLabel(w)}
            </option>
          ))}
        </select>
      </div>
      {creating && (
        <>
          <div className="field">
            <label htmlFor={`${id}-new-name`}>作品の名前</label>
            <input
              id={`${id}-new-name`}
              value={name}
              disabled={busy}
              onChange={(e) => onName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-new-subtype`}>作品の種類</label>
            <select
              id={`${id}-new-subtype`}
              value={subtype}
              disabled={busy}
              onChange={(e) => setSubtype(e.target.value)}
            >
              <option value="">選んでください</option>
              {subtypes.map(([k, text]) => (
                <option key={k} value={k}>
                  {text}
                </option>
              ))}
            </select>
          </div>
          <ClassificationChoice
            name={`${id}-new-classification`}
            value={classification}
            onChange={setClassification}
          />
        </>
      )}
      <button type="button" className="button primary" disabled={!ready || busy} onClick={attach}>
        {creating ? "作品を作って" : ""}選んだ {nf.format(selectedIds.length)} 件を付ける
      </button>
      <button
        type="button"
        className="button"
        disabled={selectedIds.length === 0 || busy}
        onClick={skip}
      >
        選んだ {nf.format(selectedIds.length)} 件を作品にまとめない
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function EventRow({
  event,
  checked,
  onToggle,
  disabled = false,
}: {
  event: WorkGroupingEvent;
  checked: boolean;
  onToggle: (on: boolean) => void;
  disabled?: boolean;
}) {
  const { viewer } = useApp();
  const title = event.title ?? "（題名なし）";
  return (
    <li>
      <label className="grouping-event">
        {viewer.canWork && (
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(ev) => onToggle(ev.target.checked)}
          />
        )}
        <span className="check-date">
          {eventDateLabel(event.startsOn, null, event.datePrecision)}
        </span>
        <span className="tag">{EVENT_KIND_SHORT[event.kind] ?? event.kind}</span>
        <span className="grouping-title">{title}</span>
        {event.episodeNumber === null && event.number !== null && (
          <span className="quiet">#{event.number} を入れます</span>
        )}
        {event.match === "title" && <span className="quiet">題名に作品の名前があります</span>}
        {event.match === "material" && (
          <span className="quiet">紐付いた告知に作品の名前があります</span>
        )}
      </label>
      <Link to={`/events/${event.id}`} className="quiet grouping-open">
        開く
      </Link>
    </li>
  );
}

function useChecked(initial: () => string[]) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(initial()));
  const toggle = (eventId: string, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(eventId);
      else next.delete(eventId);
      return next;
    });
  return [checked, toggle] as const;
}

/** 既にある作品か、同じ名前の回・号のまとまり */
function GroupCard({
  group,
  works,
  onDone,
}: {
  group: WorkGroupingGroup;
  works: GroupingWorkOption[];
  onDone: (message: string) => void;
}) {
  const { viewer } = useApp();
  const id = useId();
  const [checked, toggle] = useChecked(() =>
    group.events.filter((e) => e.match === "stem").map((e) => e.id),
  );
  const [name, setName] = useState(group.name);
  const selected = group.events.filter((e) => checked.has(e.id)).map((e) => e.id);
  const all = selected.length === group.events.length;
  const headingId = `${id}-name`;
  return (
    <section className="grouping-card" aria-labelledby={headingId}>
      <div className="grouping-head">
        <h3 id={headingId} className="grouping-name">
          {group.work ? <Link to={`/works/${group.work.id}`}>{group.work.name}</Link> : group.name}
        </h3>
        <span className="quiet">
          {group.work ? "既にある作品" : "新しい作品の候補"}・{nf.format(group.events.length)} 件
        </span>
        {viewer.canWork && group.events.length > 1 && (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              for (const e of group.events) toggle(e.id, !all);
            }}
          >
            {all ? "すべて外す" : "すべて選ぶ"}
          </button>
        )}
      </div>
      <ul className="grouping-events">
        {group.events.map((e) => (
          <EventRow
            key={e.id}
            event={e}
            checked={checked.has(e.id)}
            onToggle={(on) => toggle(e.id, on)}
          />
        ))}
      </ul>
      {viewer.canWork && (
        <AttachControls
          kind={group.events[0]?.kind}
          works={works}
          initialTarget={group.work?.id ?? NEW}
          name={name}
          onName={setName}
          initialSubtype={group.subtype}
          selectedIds={selected}
          label={`「${group.name}」に付ける`}
          onDone={onDone}
        />
      )}
    </section>
  );
}

/**
 * 1 件だけの回・号。配信の動画などは題名がばらばらなので、表から選んで同じ作品にまとめて付ける。
 * 初めは何も選ばない
 */
function SingleTable({
  title,
  kind,
  groups,
  works,
  onDone,
}: {
  title: string;
  kind: string;
  groups: WorkGroupingGroup[];
  works: GroupingWorkOption[];
  onDone: (message: string) => void;
}) {
  const { viewer } = useApp();
  const [checked, toggle] = useChecked(() => []);
  const [name, setName] = useState("");
  const rows = groups.flatMap((g) => g.events.map((e) => ({ event: e, stem: g.name })));
  const selected = rows.filter((r) => checked.has(r.event.id));
  if (rows.length === 0) return null;
  return (
    <section className="grouping-card" aria-label={title}>
      <div className="grouping-head">
        <h3 className="grouping-name">{title}</h3>
        <span className="quiet">{nf.format(rows.length)} 件</span>
      </div>
      {viewer.canWork && (
        <AttachControls
          kind={kind}
          works={works}
          initialTarget={NEW}
          name={name}
          onName={setName}
          initialSubtype={kind === "publication" ? "magazine" : null}
          selectedIds={selected.map((r) => r.event.id)}
          label={`${title}を付ける`}
          onDone={(message) => {
            setName("");
            onDone(message);
          }}
        />
      )}
      <ul className="grouping-events">
        {rows.map(({ event, stem }) => (
          <EventRow
            key={event.id}
            event={event}
            checked={checked.has(event.id)}
            onToggle={(on) => {
              toggle(event.id, on);
              // 作品の名前は、初めに選んだ行の名前（号・回の印を外したもの）にする
              if (on && name === "") setName(stem);
            }}
          />
        ))}
      </ul>
    </section>
  );
}

function GroupList({
  title,
  note,
  groups,
  works,
  onDone,
}: {
  title: string;
  note: string;
  groups: WorkGroupingGroup[];
  works: GroupingWorkOption[];
  onDone: (message: string) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <section className="grouping-section" aria-label={title}>
      <h2 className="column-title">
        {title} <span className="work-count">{nf.format(groups.length)} 組</span>
      </h2>
      <p className="quiet">{note}</p>
      {groups.map((g) => (
        <GroupCard key={g.key} group={g} works={works} onDone={onDone} />
      ))}
    </section>
  );
}

/** 「作品にまとめない」にしたもの。戻すと候補に戻る（決定記録 0082） */
function SkippedList({
  events,
  onDone,
}: {
  events: WorkGrouping["skipped"];
  onDone: (message: string) => void;
}) {
  const { source, viewer } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const restore = (eventId: string) => {
    setBusy(eventId);
    setError(null);
    source
      .setNoWork([eventId], false)
      .then(() => {
        setBusy(null);
        onDone("作品にまとめる候補に戻しました");
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(null);
      });
  };
  return (
    <details className="grouping-section grouping-skipped">
      <summary className="column-title">
        作品にまとめないもの <span className="work-count">{nf.format(events.length)} 件</span>
      </summary>
      <ul className="grouping-events">
        {events.map((e) => (
          <li key={e.id}>
            <span className="grouping-event">
              <span className="check-date">
                {eventDateLabel(e.startsOn, null, e.datePrecision)}
              </span>
              <span className="tag">{EVENT_KIND_SHORT[e.kind] ?? e.kind}</span>
              <Link to={`/events/${e.id}`} className="grouping-title">
                {e.title ?? "（題名なし）"}
              </Link>
            </span>
            {viewer.canWork && (
              <button
                type="button"
                className="link-button"
                disabled={busy !== null}
                onClick={() => restore(e.id)}
              >
                候補に戻す
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}

export function WorkGroupingPage() {
  const { source } = useApp();
  const layout = useLayout();
  const [version, setVersion] = useState(0);
  const [grouping] = useLoad(() => source.getWorkGrouping(), [source], [version]);
  const [done, setDone] = useState<string | null>(null);
  const onDone = (message: string) => {
    setDone(message);
    setVersion((v) => v + 1);
    layout.changed();
  };
  const groups = grouping.status === "ready" ? grouping.data.groups : [];
  const works = grouping.status === "ready" ? grouping.data.works : [];
  return (
    <section className="page wide">
      <div className="page-head">
        <h1 className="page-title">作品にまとめる</h1>
        <p className="page-sub">
          作品を指していない番組の回・掲載（号）を、番組・雑誌ごとに作品に付けます。付けると作品の画面に回・号として並びます。
          {grouping.status === "ready" &&
            ` 作品にまとまっていない回・号は ${nf.format(grouping.data.counts.episodes)} 件です。`}
        </p>
        <p className="field-hint">
          題名から号・回の印（2026年11月号・vol.・No.・#・第〇回）を外した名前でまとめています。番号が読めれば回・号の番号も入れます。別の作品への付け替えは、出来事の画面で行います。
        </p>
        <p className="field-hint">
          どの作品の回・号でもないもの（ほかの番組の話をしている動画など）は「作品にまとめない」にすると、候補から外れます。外したものは、この画面のいちばん下から戻せます。
        </p>
      </div>
      {done && (
        <p className="grouping-done" role="status">
          <CheckCircle2 size={16} aria-hidden="true" />
          {done}
        </p>
      )}
      {grouping.status === "loading" && <p className="quiet">読み込んでいます</p>}
      {grouping.status === "error" && (
        <p className="error" role="alert">
          読み込めませんでした: {grouping.error.message}
        </p>
      )}
      {grouping.status === "ready" && groups.length === 0 && (
        <p className="quiet">作品にまとめる候補はありません。</p>
      )}
      <GroupList
        title="既にある作品に合うもの"
        note="名前が同じものは初めから選んであります。題名に作品の名前があるだけのもの（告知・発売など）は、確かめて選んでください。"
        groups={groups.filter((g) => g.work)}
        works={works}
        onDone={onDone}
      />
      <GroupList
        title="同じ名前の回・号"
        note="同じ番組・雑誌の回・号と思われるものです。名前と種類を確かめて、作品を作って付けます。"
        groups={groups.filter((g) => !g.work && g.events.length > 1)}
        works={works}
        onDone={onDone}
      />
      {groups.some((g) => !g.work && g.events.length === 1) && (
        <section className="grouping-section" aria-label="1 件だけの回・号">
          <h2 className="column-title">1 件だけの回・号</h2>
          <p className="quiet">
            単発の出演も、番組の作品に付けておくと、同じ番組の出演をまとめて引けます。配信の動画などは、チャンネル・番組の作品を作り、選んでまとめて付けます。
          </p>
          <SingleTable
            title="番組の回"
            kind="episode"
            groups={groups.filter(
              (g) => !g.work && g.events.length === 1 && g.events[0]!.kind === "episode",
            )}
            works={works}
            onDone={onDone}
          />
          <SingleTable
            title="掲載（号）"
            kind="publication"
            groups={groups.filter(
              (g) => !g.work && g.events.length === 1 && g.events[0]!.kind === "publication",
            )}
            works={works}
            onDone={onDone}
          />
        </section>
      )}
      {grouping.status === "ready" && grouping.data.skipped.length > 0 && (
        <SkippedList events={grouping.data.skipped} onDone={onDone} />
      )}
    </section>
  );
}
