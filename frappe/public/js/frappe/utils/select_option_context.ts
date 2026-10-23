type SelectField = {
  parent?: string;
  fieldname?: string;
  context?: string;
};

export function selectOptionContext(
  value: unknown,
  field: SelectField,
  messages?: Record<string, string>
): string | undefined {
  if (
    field.context ||
    !field.parent ||
    !field.fieldname ||
    typeof value !== "string"
  ) {
    return field.context || field.parent;
  }

  for (const context of [
    `${field.parent}.${field.fieldname}`,
    field.parent,
    `Select Option: ${field.fieldname}`,
  ]) {
    if (messages?.[`${value}:${context}`]) return context;
  }
  return field.parent;
}
