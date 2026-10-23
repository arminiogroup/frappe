import { translate as __ } from "../../utils/translate";
import { translateDocFieldText } from "../../utils/translateDocField";
import type { RawMetaField } from "../FormLayout/types";
import type { ColumnOption, SyntheticColumn } from "./types";

/** Fieldtypes that hold no list-renderable value — layout/presentation breaks and
 *  child tables. A column can't be shown for any of these, so they're dropped from
 *  the add-column options. Mirrors CRM ColumnSettings' field filter. */
const NON_COLUMN_FIELDTYPES = new Set([
  "Section Break",
  "Column Break",
  "Tab Break",
  "HTML",
  "Heading",
  "Button",
  "Fold",
  "Table",
  "Table MultiSelect",
]);

/** Standard fields every doctype can show as a column, appended after the meta
 *  fields. */
function standardFields(): ReadonlyArray<{ label: string; fieldname: string }> {
  return [
    { label: __("Name"), fieldname: "name" },
    { label: __("Last Modified"), fieldname: "modified" },
    { label: __("Created On"), fieldname: "creation" },
    { label: __("Modified By"), fieldname: "modified_by" },
    { label: __("Owner"), fieldname: "owner" },
  ];
}

const toOption = (label: string, fieldname: string): ColumnOption => ({
  label,
  value: fieldname,
  fieldname,
});

/**
 * Derive a doctype's available column Field Options from its Meta fields,
 * client-side: drop the layout/no-data fieldtypes and child tables, keep only
 * fields with both a label and fieldname, then append the standard fields and any
 * host-declared synthetic columns (ADR-0033) — the union so a hidden synthetic
 * column stays re-addable, since it is not a Meta field. The component filters out
 * already-selected columns; this stays a pure Meta→options map. See CONTEXT.md
 * ("Field Options").
 */
export function getColumnOptions(
  fields: RawMetaField[],
  synthetic: SyntheticColumn[] = []
): ColumnOption[] {
  const fieldOptions = fields
    .filter(
      (f) => !NON_COLUMN_FIELDTYPES.has(f.fieldtype) && f.label && f.fieldname
    )
    .map((f) =>
      toOption(translateDocFieldText(f, f.label) as string, f.fieldname)
    );
  const standard = standardFields().map((f) => toOption(f.label, f.fieldname));
  const declared = synthetic.map((s) => toOption(s.label, s.key));
  return [...fieldOptions, ...standard, ...declared];
}
