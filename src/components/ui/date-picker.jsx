import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { format, isValid, parse } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const MONTHS = Array.from({ length: 12 }, (_, month) => ({
  value: String(month),
  label: format(new Date(2020, month, 1), 'LLLL', { locale: ptBR }),
}));

const parseStoredDate = (value) => value ? new Date(`${value}T12:00:00`) : undefined;

const isDateAllowed = (date, minDate, maxDate) => (
  isValid(date) && (!minDate || date >= minDate) && (!maxDate || date <= maxDate)
);

const GovDatePicker = ({
  id,
  value,
  onChange,
  minDate,
  maxDate,
  required = false,
  disabled = false,
  placeholder = 'DD/MM/AAAA',
  className,
  'aria-describedby': ariaDescribedBy,
}) => {
  const selectedDate = parseStoredDate(value);
  const fallbackMonth = selectedDate || maxDate || new Date();
  const [month, setMonth] = useState(fallbackMonth);
  const [typedValue, setTypedValue] = useState(selectedDate ? format(selectedDate, 'dd/MM/yyyy') : '');

  useEffect(() => {
    const nextDate = parseStoredDate(value);
    setTypedValue(nextDate ? format(nextDate, 'dd/MM/yyyy') : '');
    if (nextDate) setMonth(nextDate);
  }, [value]);

  const years = useMemo(() => {
    const first = minDate?.getFullYear() || new Date().getFullYear() - 120;
    const last = maxDate?.getFullYear() || new Date().getFullYear();
    return Array.from({ length: Math.max(1, last - first + 1) }, (_, index) => last - index);
  }, [maxDate, minDate]);

  const commitDate = (date) => {
    if (!date || !isDateAllowed(date, minDate, maxDate)) return;
    onChange(format(date, 'yyyy-MM-dd'));
    setMonth(date);
  };

  const handleTyping = (event) => {
    const digits = event.target.value.replace(/\D/g, '').slice(0, 8);
    const next = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('/');
    setTypedValue(next);
    if (!next) {
      onChange('');
      return;
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(next)) {
      const parsedDate = parse(next, 'dd/MM/yyyy', new Date());
      if (format(parsedDate, 'dd/MM/yyyy') === next && isDateAllowed(parsedDate, minDate, maxDate)) {
        commitDate(parsedDate);
      }
    }
  };

  const changeMonthPart = (monthIndex) => {
    const next = new Date(month);
    next.setDate(1);
    next.setMonth(Number(monthIndex));
    setMonth(next);
  };

  const changeYearPart = (year) => {
    const next = new Date(month);
    next.setDate(1);
    next.setFullYear(Number(year));
    setMonth(next);
  };

  return (
    <div className={cn('flex min-w-0 gap-2', className)}>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="bday"
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        value={typedValue}
        onChange={handleTyping}
        aria-describedby={ariaDescribedBy}
        aria-label="Data no formato dia, mês e ano"
        pattern="\d{2}/\d{2}/\d{4}"
      />
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="icon" disabled={disabled} aria-label="Abrir calendário" className="shrink-0">
            <CalendarDays className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" collisionPadding={16} className="w-[min(22rem,calc(100vw-2rem))] p-3">
          <div className="mb-3 grid grid-cols-[minmax(0,1fr)_7rem] gap-2" aria-label="Escolher mês e ano">
            <Select value={String(month.getMonth())} onValueChange={changeMonthPart}>
              <SelectTrigger aria-label="Mês"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((item) => <SelectItem key={item.value} value={item.value} className="capitalize">{item.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={String(month.getFullYear())} onValueChange={changeYearPart}>
              <SelectTrigger aria-label="Ano"><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map((year) => <SelectItem key={year} value={String(year)}>{year}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Calendar
            mode="single"
            month={month}
            onMonthChange={setMonth}
            selected={selectedDate}
            onSelect={commitDate}
            disabled={(date) => !isDateAllowed(date, minDate, maxDate)}
            startMonth={minDate}
            endMonth={maxDate}
            locale={ptBR}
            className="mx-auto bg-transparent p-0"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default GovDatePicker;

