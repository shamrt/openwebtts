import { cn } from "$lib/utils";
import { describe, expect, it } from "vite-plus/test";

describe("cn util", () => {
  it("merges class names and resolves the $lib alias", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
  });

  it("deduplicates conflicting tailwind classes (last wins)", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
