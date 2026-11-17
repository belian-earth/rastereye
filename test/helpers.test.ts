import { describe, it, expect } from "vitest";
import { isNodata, isAbortError, formatNum } from "../webview/helpers";
import { stretchBounds } from "../webview/range";
import { state } from "../webview/state";

describe("isNodata", () => {
  it("matches NaN and the exact nodata value", () => {
    expect(isNodata(NaN, null)).toBe(true);
    expect(isNodata(0, 0)).toBe(true);
    expect(isNodata(1, 0)).toBe(false);
    expect(isNodata(0, null)).toBe(false);
  });

  it("matches float32 samples of a nodata value float32 cannot represent", () => {
    for (const nodata of [-9999.99, 1e20, -3.4e38, 0.1]) {
      const stored = new Float32Array([nodata])[0];
      expect(stored).not.toBe(nodata);
      expect(isNodata(stored, nodata), String(nodata)).toBe(true);
    }
  });
});

describe("isAbortError", () => {
  it("trusts an aborted signal", () => {
    const c = new AbortController();
    c.abort();
    expect(isAbortError(new Error("Failed to fetch"), c.signal)).toBe(true);
  });

  it("finds an AbortError wrapped in a cause chain", () => {
    const abort = new DOMException("aborted", "AbortError");
    const wrapped = new Error("outer", { cause: new Error("inner", { cause: abort }) });
    expect(isAbortError(wrapped)).toBe(true);
    expect(isAbortError(new Error("plain"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});

describe("formatNum", () => {
  it("keeps small values that fixed decimals would round to zero", () => {
    expect(formatNum(0.00002345)).toBe("2.3450e-5");
    expect(formatNum(0.0185432)).toBe("0.0185432");
    expect(formatNum(1234.5678)).toBe("1234.57");
    expect(formatNum(42)).toBe("42");
  });
});

describe("stretchBounds", () => {
  it("passes distinct bounds through and widens equal ones", () => {
    state.valueMin = 2; state.valueMax = 9;
    expect(stretchBounds()).toEqual([2, 9]);
    state.valueMin = 5; state.valueMax = 5;
    expect(stretchBounds()).toEqual([5, 6]);
  });
});
