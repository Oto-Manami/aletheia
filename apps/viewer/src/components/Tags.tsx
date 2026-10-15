import { AVAILABILITY_LABELS } from "../format.ts";

/** 公開区分と有料の印。公開は印を付けない（非公開・有料だけを目立たせる） */
export function Tags({
  classification,
  availability,
}: {
  classification?: string | null | undefined;
  availability?: string | null | undefined;
}) {
  return (
    <>
      {classification === "private" && <span className="tag tag-private">非公開</span>}
      {(availability === "paid" || availability === "mixed") && (
        <span className="tag tag-paid">{AVAILABILITY_LABELS[availability]}</span>
      )}
    </>
  );
}
