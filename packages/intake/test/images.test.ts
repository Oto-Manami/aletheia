import { describe, expect, it } from "vitest";
import { draftSchema } from "../src/draft.ts";
import { chosenImagesOnlyConfig, onlyChosenImages } from "../src/images.ts";

describe("情報源の設定（写っている人を付けた画像だけを残すか）", () => {
  it("chosen_images_only が true のときだけ残す対象にする", () => {
    expect(chosenImagesOnlyConfig({ chosen_images_only: true })).toBe(true);
    expect(chosenImagesOnlyConfig({ chosen_images_only: "true" })).toBe(false);
    expect(chosenImagesOnlyConfig({ chosen_images_only: false })).toBe(false);
    expect(chosenImagesOnlyConfig({ url_patterns: [] })).toBe(false);
    expect(chosenImagesOnlyConfig(null)).toBe(false);
  });
});

describe("写っている人を付けたものだけを残す", () => {
  it("画像と動画は、写っている人を付けたものだけを残す。本文・ページは残す（決定記録 0057）", () => {
    const person = "00000000-0000-4000-8000-000000000001";
    const draft = draftSchema.parse({
      version: 1,
      post: { classification: "private" },
      assets: [
        { ref: "img1", media_type: "image" },
        { ref: "img2", media_type: "image" },
        { ref: "vid1", media_type: "video" },
        { ref: "vid2", media_type: "video" },
        { ref: "page", media_type: "webpage" },
        { ref: "body", media_type: "text", texts: [{ text_type: "body", content: "架空の本文" }] },
      ],
      links: [
        { from: { asset: "img1" }, to_type: "entity", to_id: person, role: "appears" },
        { from: { asset: "vid2" }, to_type: "entity", to_id: person, role: "appears" },
        {
          from: { asset: "vid1" },
          to_type: "entity",
          to_id: person,
          role: "appears",
          origin: "rule",
          confidence: 0.5,
          accepted: false,
        },
      ],
    });
    const kept = onlyChosenImages(draft);
    expect(kept.assets.map((a) => a.ref)).toEqual(["img1", "vid2", "page", "body"]);
    expect(kept.links.map((l) => (l.from === "post" ? "post" : l.from.asset))).toEqual([
      "img1",
      "vid2",
    ]);
  });
});
