import { translate as __ } from "./translate";
import { selectOptionContext } from "../../../frappe/public/js/frappe/utils/select_option_context";

type DocFieldTranslation = {
  parent?: string;
  fieldname?: string;
  context?: string;
  fieldtype: string;
};

export function translateDocFieldText(
  field: DocFieldTranslation,
  text: string | undefined,
): string | undefined {
  return field.parent && text ? __(text, [], field.parent) : text;
}

export function translateSelectOption(
  field: DocFieldTranslation,
  value: string,
): string {
  return field.parent && field.fieldtype === "Select"
    ? __(
        value,
        [],
        selectOptionContext(
          value,
          field,
          (globalThis as { frappe?: { _messages?: Record<string, string> } })
            .frappe?._messages
        )
      )
    : value;
}
