// 承認の画面の写真と動画。写真を押すと、蓄積対象の人物（本人）が写っている印を付け外しする。
// 一緒に写っている人は、写真の下のプルダウンから選ぶ。
// 動画は表紙の画像を写真と同じ形で並べ、下の「再生」で保存先の動画を重ねて見る（設計書 決定記録 0057）。
//
// 写真は元の並びのまま出す（押したときに並びが変わらないように）。
//
// 連載・企画（シリーズ）と撮影した人も、写真ごとに付ける（設計書 決定記録 0064）。シリーズは選ぶと全部の写真に
// 付き、関係の無い写真だけ外せる。

import type { DraftInput } from "@aletheia/intake/draft";
import { Camera, Check, Play, X } from "lucide-react";
import { useCallback, useState } from "react";
import {
  appearsOf,
  imageRefsOf,
  photographersOf,
  seriesOf,
  seriesOfAsset,
  setAppears,
  setAppearsAll,
  setPhotographer,
  setSeries,
  setSeriesAll,
} from "../source/tags.ts";
import type { RefLabel } from "../source/types.ts";
import { EntityPicker } from "./EntityPicker.tsx";
import { PersonSelect } from "./PersonSelect.tsx";
import { VideoPlayer } from "./VideoPlayer.tsx";

function previewOf(draft: DraftInput, ref: string, previews: Record<string, string>) {
  const asset = (draft.assets ?? []).find((a) => a.ref === ref);
  // 元のページの画像は、画像の代わりにだけ使う（動画の source_url は動画そのもの）
  const source = asset?.media_type === "image" ? asset.attributes?.["source_url"] : undefined;
  return previews[ref] ?? (typeof source === "string" ? source : null);
}

export function PhotoTags({
  draft,
  onChange,
  subject,
  candidates,
  name,
  previews,
  readOnly,
  chosenOnly = false,
  playUrls = {},
  loadMedia,
  pickSeries = false,
}: {
  draft: DraftInput;
  onChange: (d: DraftInput) => void;
  /** 写真を押して印を付ける人（蓄積対象の人物）。読み込み中は null */
  subject: RefLabel | null;
  candidates: RefLabel[];
  name: (id: string) => string;
  previews: Record<string, string>;
  readOnly: boolean;
  /** 写っている人を付けた写真・動画だけを保存する（振り分けで残したもの・情報源の設定があるもの。設計書 決定記録 0037・0040・0057） */
  chosenOnly?: boolean;
  /** 動画（ref）ごとの、保存先で再生する URL */
  playUrls?: Record<string, string>;
  /** 保存先で再生できない動画を、仮置きのファイルから読む（SHA-256 → 再生用の URL） */
  loadMedia?: (sha256: string) => Promise<string>;
  /** シリーズを探して選ぶ・作る欄を出す（作品を探す窓口のある画面だけ。決定記録 0064） */
  pickSeries?: boolean;
}) {
  const [playing, setPlaying] = useState<string | null>(null);
  // 選んだばかりのシリーズの名前（名前を読み込む前に出すため）
  const [picked, setPicked] = useState<Record<string, string>>({});
  const close = useCallback(() => setPlaying(null), []);
  const refs = imageRefsOf(draft);
  if (refs.length === 0) return null;
  const assetOf = (ref: string) => (draft.assets ?? []).find((a) => a.ref === ref);
  const isVideo = (ref: string) => assetOf(ref)?.media_type === "video";
  const videoCount = refs.filter(isVideo).length;
  const photoCount = refs.length - videoCount;
  const heading = [
    photoCount > 0 ? `写真 ${photoCount} 枚` : null,
    videoCount > 0 ? `動画 ${videoCount} 本` : null,
  ]
    .filter(Boolean)
    .join("・");
  const playingAsset = playing ? assetOf(playing) : undefined;
  const playingSha = playingAsset?.sha256;
  const marked = subject ? refs.filter((ref) => appearsOf(draft, ref).includes(subject.id)) : [];
  const all = subject !== null && marked.length === refs.length;
  const others = candidates.filter((c) => c.id !== subject?.id);
  const series = seriesOf(draft);
  const label = (id: string) => picked[id] ?? name(id);

  return (
    <section className="panel panel-pad photos" aria-labelledby="photos-title">
      <header className="photos-head">
        <div className="photos-title">
          <h3 id="photos-title" className="column-title">
            {heading}
          </h3>
          <p className="photos-lead">
            {subject ? (
              <>
                <strong>{subject.label}</strong> が写っている
                {videoCount > 0 ? "写真・動画" : "写真"}
                を押して印を付けます。 一緒に写っている人は、写真の下から選びます。
                {videoCount > 0 && " 動画は、下の「再生」で中身を確かめられます。"}
                {chosenOnly &&
                  " 写っている人を付けた写真・動画だけを保存します（ほかは保存しません）。"}
              </>
            ) : (
              "読み込んでいます"
            )}
          </p>
        </div>
        {subject && (
          <div className="photos-count">
            <span className="photos-count-number" aria-live="polite">
              {marked.length} / {refs.length} 枚
            </span>
            <button
              type="button"
              className="link-button"
              disabled={readOnly}
              onClick={() => onChange(setAppearsAll(draft, subject.id, !all))}
            >
              {all ? "すべて外す" : "すべてに付ける"}
            </button>
          </div>
        )}
      </header>
      {(series.length > 0 || pickSeries) && (
        <div className="photo-series" role="group" aria-label="シリーズ（連載・企画）">
          <span className="photo-series-title">シリーズ</span>
          {series.map((id) => {
            const count = refs.filter((ref) => seriesOfAsset(draft, ref).includes(id)).length;
            return (
              <span key={id} className="person-chip is-on">
                {label(id)}（{count} / {refs.length} 枚）
                <button
                  type="button"
                  className="icon-button"
                  disabled={readOnly}
                  aria-label={`すべての写真を ${label(id)} から外す`}
                  onClick={() => onChange(setSeriesAll(draft, id, false))}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            );
          })}
          {pickSeries && !readOnly && (
            <EntityPicker
              label="シリーズを足す（連載・企画）"
              types={["work"]}
              createType="work"
              defaultSubtype="series"
              onlySubtypes={["series"]}
              value={null}
              addMode
              exclude={series}
              placeholder="連載・企画の名前"
              onChange={(p) => {
                if (!p) return;
                setPicked((m) => ({ ...m, [p.id]: p.label }));
                onChange(setSeriesAll(draft, p.id, true));
              }}
            />
          )}
        </div>
      )}
      {playing && (
        <VideoPlayer
          title={`動画 ${refs.indexOf(playing) + 1}`}
          playUrl={playUrls[playing] ?? null}
          load={loadMedia && playingSha ? () => loadMedia(playingSha) : null}
          onClose={close}
        />
      )}
      <ul className={`photo-tags ${marked.length > 0 ? "has-marks" : ""}`}>
        {refs.map((ref, i) => {
          const n = i + 1;
          const people = appearsOf(draft, ref);
          const on = subject !== null && people.includes(subject.id);
          const rest = people.filter((p) => p !== subject?.id);
          const preview = previewOf(draft, ref, previews);
          const video = isVideo(ref);
          const kind = video ? "動画" : "写真";
          const canPlay = playUrls[ref] !== undefined || (!!loadMedia && !!assetOf(ref)?.sha256);
          return (
            <li key={ref} className={`photo-tag ${on ? "is-on" : ""}`}>
              <button
                type="button"
                className="photo-tag-image"
                aria-pressed={on}
                aria-label={
                  subject
                    ? `${kind} ${n}${on ? `（${subject.label} の印あり。押すと外す）` : `（押すと ${subject.label} の印を付ける）`}`
                    : `${kind} ${n}`
                }
                disabled={readOnly || !subject}
                onClick={() => subject && onChange(setAppears(draft, ref, subject.id, !on))}
              >
                {preview ? (
                  <img src={preview} alt="" loading="lazy" />
                ) : (
                  <span className="triage-image-empty">
                    {kind} {n}
                  </span>
                )}
                {video && (
                  <span className="photo-tag-video" aria-hidden="true">
                    <Play size={18} />
                  </span>
                )}
                {on && subject && (
                  <span className="photo-tag-mark" aria-hidden="true">
                    <Check size={12} />
                    {subject.label}
                  </span>
                )}
                <span className="photo-tag-number" aria-hidden="true">
                  {n}
                </span>
              </button>
              {video && (
                <button
                  type="button"
                  className="button photo-tag-play"
                  disabled={!canPlay}
                  onClick={() => setPlaying(ref)}
                  title={canPlay ? undefined : "再生できるファイルがありません"}
                >
                  <Play size={14} aria-hidden="true" />
                  再生
                </button>
              )}
              <div
                className="photo-tag-people"
                role="group"
                aria-label={`${kind} ${n} に一緒に写っている人`}
              >
                {rest.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="person-chip is-on"
                    disabled={readOnly}
                    aria-label={`${name(p)} を${kind} ${n} から外す`}
                    onClick={() => onChange(setAppears(draft, ref, p, false))}
                  >
                    {name(p)}
                    <X size={12} aria-hidden="true" />
                  </button>
                ))}
                <PersonSelect
                  candidates={others}
                  exclude={people}
                  label={`${kind} ${n} に一緒に写っている人を足す`}
                  disabled={readOnly}
                  onPick={(id) => onChange(setAppears(draft, ref, id, true))}
                />
              </div>
              {series.length > 0 && (
                <div
                  className="photo-tag-series"
                  role="group"
                  aria-label={`${kind} ${n} のシリーズ`}
                >
                  {series.map((id) => {
                    const inIt = seriesOfAsset(draft, ref).includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`person-chip ${inIt ? "is-on" : "is-off"}`}
                        aria-pressed={inIt}
                        disabled={readOnly}
                        aria-label={`${kind} ${n} を ${label(id)} ${inIt ? "から外す" : "に入れる"}`}
                        onClick={() => onChange(setSeries(draft, ref, id, !inIt))}
                      >
                        {label(id)}
                      </button>
                    );
                  })}
                </div>
              )}
              <div
                className="photo-tag-people"
                role="group"
                aria-label={`${kind} ${n} を撮影した人`}
              >
                {photographersOf(draft, ref).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="person-chip is-on"
                    disabled={readOnly}
                    aria-label={`撮影した人 ${name(p)} を${kind} ${n} から外す`}
                    onClick={() => onChange(setPhotographer(draft, ref, p, false))}
                  >
                    <Camera size={12} aria-hidden="true" />
                    {name(p)}
                    <X size={12} aria-hidden="true" />
                  </button>
                ))}
                {photographersOf(draft, ref).length === 0 && (
                  <PersonSelect
                    candidates={candidates}
                    exclude={[]}
                    label={`${kind} ${n} を撮影した人を選ぶ`}
                    placeholder="＋ 撮影した人"
                    disabled={readOnly}
                    onPick={(id) => onChange(setPhotographer(draft, ref, id, true))}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
