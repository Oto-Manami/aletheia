import { describe, expect, it } from "vitest";
import { chosenImagesOnlyConfig } from "../src/images.ts";

describe("情報源の設定（写っている人を付けた画像だけを残すか）", () => {
  it("chosen_images_only が true のときだけ残す対象にする", () => {
    expect(chosenImagesOnlyConfig({ chosen_images_only: true })).toBe(true);
    expect(chosenImagesOnlyConfig({ chosen_images_only: "true" })).toBe(false);
    expect(chosenImagesOnlyConfig({ chosen_images_only: false })).toBe(false);
    expect(chosenImagesOnlyConfig({ url_patterns: [] })).toBe(false);
    expect(chosenImagesOnlyConfig(null)).toBe(false);
  });
});
