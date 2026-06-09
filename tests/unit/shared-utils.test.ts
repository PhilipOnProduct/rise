import { describe, expect, it } from "vitest";
import { dbErr, isUuid, UUID_RE } from "@/lib/db-utils";
import { stripJsonFences } from "@/lib/json-utils";

describe("dbErr", () => {
  it("joins the non-enumerable PostgrestError fields", () => {
    expect(dbErr({ message: "boom", code: "23505", details: "dup", hint: null })).toBe(
      "boom | 23505 | dup",
    );
  });

  it("stringifies non-object errors", () => {
    expect(dbErr("plain")).toBe("plain");
    expect(dbErr(null)).toBe("null");
  });

  it("falls back to JSON for objects with none of the known fields", () => {
    expect(dbErr({ other: 1 })).toBe('{"other":1}');
  });
});

describe("isUuid", () => {
  it("accepts well-formed UUIDs in either case", () => {
    expect(isUuid("123e4567-e89b-42d3-a456-426614174000")).toBe(true);
    expect(isUuid("123E4567-E89B-42D3-A456-426614174000")).toBe(true);
  });

  it("rejects malformed values and non-strings", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("123e4567e89b42d3a456426614174000")).toBe(false);
    expect(isUuid(42)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });

  it("exports the regex for callers that need it directly", () => {
    expect(UUID_RE.test("123e4567-e89b-42d3-a456-426614174000")).toBe(true);
  });
});

describe("stripJsonFences", () => {
  it("strips ```json fences", () => {
    expect(stripJsonFences('```json\n{"a": 1}\n```')).toBe('{"a": 1}');
  });

  it("strips anonymous fences", () => {
    expect(stripJsonFences('```\n{"a": 1}\n```')).toBe('{"a": 1}');
  });

  it("handles leading/trailing whitespace around the fences", () => {
    expect(stripJsonFences('  \n```json\n{"a": 1}\n```  \n')).toBe('{"a": 1}');
  });

  it("leaves unfenced JSON untouched apart from trimming", () => {
    expect(stripJsonFences('  {"a": 1}  ')).toBe('{"a": 1}');
  });
});
