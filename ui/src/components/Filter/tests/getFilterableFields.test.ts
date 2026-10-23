import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { getFilterableFields, pickFilterFields } from "../getFilterableFields";
import type { RawMetaField } from "../../FormLayout/types";

describe("getFilterableFields", () => {
  it("labels people who liked the record separately from the reaction", () => {
    const previous = (globalThis as { __?: unknown }).__;
    const jquery = {};
    const host = {
      frappe: { _messages: { Like: "Mi piace", "Liked By": "Piaciuto a" } },
      window: {} as {
        __?: (message: string, args?: unknown[], context?: string) => string;
      },
      $: jquery,
      jQuery: jquery,
    };
    runInNewContext(
      readFileSync(
        new URL(
          "../../../../../frappe/public/js/frappe/format.js",
          import.meta.url
        ),
        "utf8"
      ),
      host
    );
    runInNewContext(
      readFileSync(
        new URL(
          "../../../../../frappe/public/js/frappe/translate.js",
          import.meta.url
        ),
        "utf8"
      ),
      host
    );
    Object.assign(globalThis, { __: host.window.__ });
    try {
      const result = getFilterableFields([], "Task");
      expect(result.find((field) => field.fieldname === "_liked_by")).toEqual({
        label: "Piaciuto a",
        value: "_liked_by",
        fieldname: "_liked_by",
        fieldtype: "Data",
        options: undefined,
      });
      const supplied = {
        fieldname: "_liked_by",
        fieldtype: "Data" as const,
        label: "Like",
      };
      expect(pickFilterFields(result, [supplied])[0]).toMatchObject(supplied);
    } finally {
      if (previous === undefined) delete (globalThis as { __?: unknown }).__;
      else Object.assign(globalThis, { __: previous });
    }
  });
  it("derives a filterable field from Meta, stamping label/value/fieldname", () => {
    const fields: RawMetaField[] = [
      { fieldname: "title", fieldtype: "Data", label: "Title" },
    ];
    const result = getFilterableFields(fields, "Lead");
    expect(result).toContainEqual({
      label: "Title",
      value: "title",
      fieldname: "title",
      fieldtype: "Data",
      options: undefined,
    });
  });

  it("keeps an Autocomplete field with its options for multi-select filtering", () => {
    const result = getFilterableFields(
      [
        {
          fieldname: "source",
          fieldtype: "Autocomplete",
          label: "Source",
          options: "Web\nReferral",
        },
      ],
      "Lead"
    );
    expect(result.find((f) => f.fieldname === "source")?.options).toBe(
      "Web\nReferral"
    );
  });

  it("drops fields whose fieldtype is not filterable", () => {
    const fields: RawMetaField[] = [
      { fieldname: "sec", fieldtype: "Section Break" },
      { fieldname: "kids", fieldtype: "Table", options: "Child" },
      { fieldname: "title", fieldtype: "Data", label: "Title" },
    ];
    const names = getFilterableFields(fields, "Lead").map((f) => f.fieldname);
    expect(names).toContain("title");
    expect(names).not.toContain("sec");
    expect(names).not.toContain("kids");
  });

  it("prepends the standard fields ahead of meta fields", () => {
    const result = getFilterableFields(
      [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
      "Lead"
    );
    const names = result.map((f) => f.fieldname);
    expect(names.slice(0, 8)).toEqual([
      "name",
      "owner",
      "modified_by",
      "_user_tags",
      "_liked_by",
      "_assign",
      "creation",
      "modified",
    ]);
    expect(names[names.length - 1]).toBe("title");
  });

  it("carries Select options through for fieldtype-aware value inputs", () => {
    const result = getFilterableFields(
      [
        {
          fieldname: "status",
          fieldtype: "Select",
          label: "Status",
          options: "Open\nClosed",
        },
      ],
      "Lead"
    );
    expect(result.find((f) => f.fieldname === "status")?.options).toBe(
      "Open\nClosed"
    );
  });

  it("stamps the doctype as the name field's Link target so Name filters search its records", () => {
    const result = getFilterableFields([], "CRM Lead");
    expect(result.find((f) => f.fieldname === "name")?.options).toBe(
      "CRM Lead"
    );
  });
});

describe("pickFilterFields", () => {
  const available = getFilterableFields(
    [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
    "Lead"
  );

  it("offers every field when the host names none", () => {
    expect(pickFilterFields(available)).toEqual(available);
  });

  it("offers only the named fields, in the host's order, with its declarations", () => {
    const picked = pickFilterFields(available, [
      { fieldname: "source", fieldtype: "Data", label: "Source" },
      "title",
      "missing",
    ]);
    expect(picked.map((f) => f.fieldname)).toEqual(["source", "title"]);
    expect(picked[0].value).toBe("source");
  });
});
