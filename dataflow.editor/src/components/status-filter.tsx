import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export type ListStatus = 'active' | 'archived';

type Props = {
  value: ListStatus;
  onChange: (value: ListStatus) => void;
  /** distinguishes the ids when two lists are on one page */
  idPrefix: string;
};

/** Active | Archived, next to a list's title (projects, flows). */
export function StatusFilter({ value, onChange, idPrefix }: Props) {
  return (
    <RadioGroup value={value} onValueChange={next => onChange(next as ListStatus)} aria-label="Show" className="flex gap-4">
      <div className="flex items-center gap-2">
        <RadioGroupItem value="active" id={`${idPrefix}-active`} />
        <Label htmlFor={`${idPrefix}-active`}>Active</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="archived" id={`${idPrefix}-archived`} />
        <Label htmlFor={`${idPrefix}-archived`}>Archived</Label>
      </div>
    </RadioGroup>
  );
}
