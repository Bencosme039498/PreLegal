import { isInvalid, type TemplateField } from "@/lib/fill-template";
import { inputClass, labelClass } from "./input-styles";

interface FieldInputProps {
  field: TemplateField;
  value: string;
  onChange: (key: string, value: string) => void;
}

/** Renders the right form control for a catalog field type. */
export function FieldInput({ field, value, onChange }: FieldInputProps) {
  const invalid = isInvalid(field, value);
  const errorId = `${field.key}-error`;
  const common = {
    id: field.key,
    name: field.key,
    value,
    required: field.required,
    placeholder: field.example ? `e.g. ${field.example}` : undefined,
    className: inputClass,
    "aria-invalid": invalid || undefined,
    "aria-describedby": invalid ? errorId : undefined,
  };
  const handle = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    onChange(field.key, e.target.value);

  let control: React.ReactNode;
  switch (field.type) {
    case "textarea":
    case "address":
      control = <textarea {...common} rows={field.type === "address" ? 2 : 3} onChange={handle} />;
      break;
    case "date":
      control = <input {...common} type="date" onChange={handle} />;
      break;
    case "integer":
      control = <input {...common} type="number" inputMode="numeric" min={0} step={1} onChange={handle} />;
      break;
    case "select":
      control = (
        <select {...common} onChange={handle}>
          <option value="">Select…</option>
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
      break;
    default:
      control = <input {...common} type="text" onChange={handle} />;
  }

  return (
    <div>
      <label htmlFor={field.key} className={labelClass}>
        {field.label}
        {field.required && <span className="ml-0.5 text-red-600" aria-hidden="true">*</span>}
      </label>
      {control}
      {invalid && (
        <p id={errorId} className="mt-1 text-xs text-red-600">
          Enter a whole number (0 or more).
        </p>
      )}
    </div>
  );
}
