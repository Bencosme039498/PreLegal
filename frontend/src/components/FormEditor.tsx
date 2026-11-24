import type { FieldSection, FieldValues } from "@/lib/fill-template";
import { FieldInput } from "./FieldInput";

interface FormEditorProps {
  sections: FieldSection[];
  values: FieldValues;
  onChange: (key: string, value: string) => void;
}

/** One fieldset per section (parties, then details) with a control per template field. */
export function FormEditor({ sections, values, onChange }: FormEditorProps) {
  return (
    <form className="space-y-6" onSubmit={(e) => e.preventDefault()} noValidate>
      {sections.map((section) => (
        <fieldset key={section.title} className="space-y-4 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <legend className="px-1 text-sm font-semibold tracking-wide text-stone-500 uppercase">{section.title}</legend>
          {section.fields.map((field) => (
            <FieldInput key={field.key} field={field} value={values[field.key] ?? ""} onChange={onChange} />
          ))}
        </fieldset>
      ))}
    </form>
  );
}
