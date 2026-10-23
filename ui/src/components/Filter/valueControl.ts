import { translate as __ } from "../../utils/translate";
import { isOptionField } from "./operators";
import type { Filter, FilterField } from "./types";
import type { FieldMeta } from "../Fields/types";

// Type groups are declared here rather than imported from `operators.ts` so that
// module stays a pure operator helper.
const CHECK_TYPES = ["Check"];
const LINK_TYPES = ["Link", "Dynamic Link"];
const NUMBER_TYPES = ["Float", "Int", "Currency", "Percent"];
const SELECT_TYPES = ["Select", "Autocomplete"];
const DATE_TYPES = ["Date", "Datetime"];
const DURATION_TYPES = ["Duration"];
const RATING_TYPES = ["Rating"];
const TEXT_OPERATORS = ["like", "not like", "in", "not in"];

/**
 * Which input a condition's value renders in. Naming the control rather than
 * importing it keeps this module free of `.vue` imports, and so loadable by the
 * test runner; `valueControlComponents.ts` maps the ids to components.
 */
export type ValueControlId =
  | "set"
  | "timespan"
  | "multiSelect"
  | "multiLink"
  | "text"
  | "select"
  | "link"
  | "number"
  | "dateRange"
  | "date"
  | "datetime"
  | "duration"
  | "rating";

export interface ValueControlSpec {
  control: ValueControlId;
  props: Record<string, unknown>;
}

function setOptions() {
  return [
    { label: __("Set", [], "Filter Value"), value: "set" },
    { label: __("Not Set", [], "Filter Value"), value: "not set" },
  ];
}

function timespanOptions() {
  return [
    { label: __("Last Week"), value: "last week" },
    { label: __("Last Month"), value: "last month" },
    { label: __("Last Quarter"), value: "last quarter" },
    { label: __("Last 6 Months"), value: "last 6 months" },
    { label: __("Last Year"), value: "last year" },
    { label: __("Yesterday"), value: "yesterday" },
    { label: __("Today"), value: "today" },
    { label: __("Tomorrow"), value: "tomorrow" },
    { label: __("This Week"), value: "this week" },
    { label: __("This Month"), value: "this month" },
    { label: __("This Quarter"), value: "this quarter" },
    { label: __("This Year"), value: "this year" },
    { label: __("Next Week"), value: "next week" },
    { label: __("Next Month"), value: "next month" },
    { label: __("Next Quarter"), value: "next quarter" },
    { label: __("Next 6 Months"), value: "next 6 months" },
    { label: __("Next Year"), value: "next year" },
  ];
}

/** Field meta passed to a `Fields` value input — no label/description so the
 *  control renders bare inside a compact condition row. */
function bareField(
  field: FilterField,
  overrides: Partial<FieldMeta> = {},
): FieldMeta {
  return {
    fieldname: field.fieldname,
    fieldtype: field.fieldtype,
    options: field.options,
    parent: field.parent,
    context: field.context,
    ...overrides,
  };
}

/**
 * Pick the control for a condition's value: operator first, then fieldtype. The
 * operator wins — `is` means Set/Not Set and the like/in family means free text
 * whatever the fieldtype is — so no control is handed an unrepresentable value.
 */
export function valueControl(f: Filter): ValueControlSpec {
  const operator = f.operator;
  const field = f.field;
  const fieldtype = field?.fieldtype ?? "Data";
  const ph = placeholder(f);

  if (operator === "is" || operator === "is not") {
    return { control: "set", props: { options: setOptions(), placeholder: ph } };
  }
  if (operator === "timespan") {
    return {
      control: "timespan",
      props: { options: timespanOptions(), placeholder: ph },
    };
  }
  // `in` / `not in` over an option field picks the field's values rather than
  // typing a comma string; Dynamic Link and free text fall through to the
  // TextInput below.
  if (
    (operator === "in" || operator === "not in") &&
    isOptionField(fieldtype)
  ) {
    if (LINK_TYPES.includes(fieldtype)) {
      return { control: "multiLink", props: { field: field! } };
    }
    return { control: "multiSelect", props: { field: field! } };
  }
  if (TEXT_OPERATORS.includes(operator)) {
    return { control: "text", props: { type: "text", placeholder: ph } };
  }

  if (SELECT_TYPES.includes(fieldtype) || CHECK_TYPES.includes(fieldtype)) {
    const options = CHECK_TYPES.includes(fieldtype)
      ? "Yes\nNo"
      : field?.options;
    return {
      control: "select",
      props: { field: bareField(field!, { options, placeholder: ph }) },
    };
  }
  if (LINK_TYPES.includes(fieldtype)) {
    // Dynamic Link has no fixed target doctype to pick against — plain text.
    if (fieldtype === "Dynamic Link")
      return { control: "text", props: { type: "text", placeholder: ph } };
    return {
      control: "link",
      props: { field: bareField(field!, { placeholder: ph }) },
    };
  }
  if (NUMBER_TYPES.includes(fieldtype)) {
    return {
      control: "number",
      props: { field: bareField(field!, { placeholder: ph }) },
    };
  }
  if (DATE_TYPES.includes(fieldtype) && operator === "between") {
    return { control: "dateRange", props: { iconLeft: "", placeholder: ph } };
  }
  if (DURATION_TYPES.includes(fieldtype)) {
    return {
      control: "duration",
      props: { field: bareField(field!, { placeholder: ph }) },
    };
  }
  if (RATING_TYPES.includes(fieldtype)) {
    return { control: "rating", props: { field: bareField(field!) } };
  }
  if (DATE_TYPES.includes(fieldtype)) {
    const control = fieldtype === "Date" ? "date" : "datetime";
    return {
      control,
      props: { field: bareField(field!, { placeholder: ph }) },
    };
  }
  return { control: "text", props: { type: "text", placeholder: ph } };
}

/** Per-operator / per-fieldtype placeholder copy. `like` / `not like` prompt
 *  for a bare term rather than `%John%`: `serializeFilters` wraps the value in
 *  `%` itself, so prompting for the wildcards would mislead. */
export function placeholder(f: Filter): string {
  const fieldtype = f.field?.fieldtype ?? "Data";
  if (f.operator === "between") return __("Select a date range");
  if (f.operator === "in" || f.operator === "not in")
    return NUMBER_TYPES.includes(fieldtype)
      ? "100, 200, 300"
      : __("Enter comma-separated values");
  if (f.operator === "like" || f.operator === "not like")
    return NUMBER_TYPES.includes(fieldtype) ? "100" : __("Enter a value");
  if (f.operator === "is" || f.operator === "is not") return __("Set", [], "Filter Value");
  if (f.operator === "timespan") return __("Last Week");
  if (NUMBER_TYPES.includes(fieldtype)) return "1000";
  if (fieldtype === "Datetime") return __("Select a date and time");
  if (fieldtype === "Date") return __("Select a date");
  if (CHECK_TYPES.includes(fieldtype)) return __("Yes");
  if (LINK_TYPES.includes(fieldtype)) return __("Select a Value");
  if (SELECT_TYPES.includes(fieldtype)) return __("Select an Option");
  return __("Enter a value");
}
