import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type Props = Omit<React.ComponentProps<'input'>, 'type' | 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
};

/**
 * A secret's value, masked, with an eye to show it while typing. It is a text field masked by CSS, not a password
 * field: a password field next to a name makes the browser offer to save a login ("Save password?"), which a secret
 * is not. The attributes also keep password managers (1Password, LastPass) away.
 */
export function SecretValueInput({ value, onChange, className, ...props }: Props) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        type="text"
        value={value}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        data-bwignore
        data-form-type="other"
        style={show ? undefined : ({ WebkitTextSecurity: 'disc' } as React.CSSProperties)}
        className={cn('pr-10 font-mono', className)}
        onChange={event => onChange(event.target.value)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
        aria-label={show ? 'Hide the value' : 'Show the value'}
        aria-pressed={show}
        onClick={() => setShow(!show)}
      >
        {show ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  );
}
