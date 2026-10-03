import BrazilStateFlag from '@/components/onboarding/BrazilStateFlag';
import { getStateName } from '@/lib/brazilianLocations';
import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

// Adapts existing form handlers to the shared accessible GOVRP dropdown.
export function GovSelect({ value, onChange, children, id, className, disabled, 'aria-label': ariaLabel }) {
  const options = React.Children.toArray(children).flatMap(child => child?.type === React.Fragment ? React.Children.toArray(child.props.children) : [child]);
  const empty = '__govrp_empty__';
  return <Select value={value === '' || value == null ? empty : String(value)} disabled={disabled} onValueChange={next => onChange?.({ target: { id, value: next === empty ? '' : next } })}>
    <SelectTrigger id={id} aria-label={ariaLabel} className={className}><SelectValue /></SelectTrigger>
    <SelectContent className="max-h-[220px] overflow-y-auto">
      {options.filter(React.isValidElement).map(option => <SelectItem aria-label={getStateName(option.props.value) || undefined} textValue={getStateName(option.props.value) || undefined} key={String(option.props.value)} value={option.props.value === '' ? empty : String(option.props.value)} disabled={option.props.disabled}>{getStateName(option.props.value) ? <span className="inline-flex items-center gap-2"><span aria-hidden="true"><BrazilStateFlag code={option.props.value} className="h-4 w-6"/></span>{getStateName(option.props.value)}</span> : option.props.children}</SelectItem>)}
    </SelectContent>
  </Select>;
}
