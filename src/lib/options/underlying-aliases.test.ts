import { describe, expect, it } from "vitest";
import { resolveUnderlyingAlias } from "./underlying-aliases";

describe("resolveUnderlyingAlias", () => {
  it("maps NIFTY to the instruments table's full index name", () => {
    expect(resolveUnderlyingAlias("NIFTY")).toBe("NIFTY 50");
  });

  it("maps BANKNIFTY to the instruments table's full index name", () => {
    expect(resolveUnderlyingAlias("BANKNIFTY")).toBe("NIFTY BANK");
  });

  it("maps FINNIFTY to the instruments table's full index name", () => {
    expect(resolveUnderlyingAlias("FINNIFTY")).toBe("NIFTY FIN SERVICE");
  });

  it("maps MIDCPNIFTY to the instruments table's full index name", () => {
    expect(resolveUnderlyingAlias("MIDCPNIFTY")).toBe("NIFTY MIDCAP 100");
  });

  it("is case-insensitive on the input code", () => {
    expect(resolveUnderlyingAlias("banknifty")).toBe("NIFTY BANK");
  });

  it("passes through a symbol that already matches the instruments table naming", () => {
    expect(resolveUnderlyingAlias("NIFTY 50")).toBe("NIFTY 50");
  });

  it("passes through an unrecognized symbol unchanged", () => {
    expect(resolveUnderlyingAlias("RELIANCE")).toBe("RELIANCE");
  });
});
