import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Phone } from 'lucide-react';
import { getCountries, getCountryCallingCode, parsePhoneNumber } from 'react-phone-number-input';
import { AsYouType } from 'libphonenumber-js';
import pt from 'react-phone-number-input/locale/pt.json';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const countryFlag = (countryCode) => String(countryCode)
  .toUpperCase()
  .replace(/[A-Z]/g, (letter) => String.fromCodePoint(letter.charCodeAt(0) + 127397));

const COUNTRIES = getCountries()
  .map((code) => ({
    code,
    name: pt[code] || code,
    callingCode: `+${getCountryCallingCode(code)}`,
    flag: countryFlag(code),
  }))
  .sort((first, second) => first.name.localeCompare(second.name, 'pt-BR'));

const GovPhoneInput = ({ id, value, onChange, defaultCountry = 'BR', required = false, disabled = false }) => {
  const parsedValue = value ? parsePhoneNumber(value) : null;
  const [country, setCountry] = useState(parsedValue?.country || defaultCountry);
  const [nationalNumber, setNationalNumber] = useState(parsedValue?.nationalNumber || '');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!value) {
      setNationalNumber('');
      return;
    }
    const parsed = parsePhoneNumber(value);
    if (parsed?.country) setCountry(parsed.country);
    if (parsed?.nationalNumber) setNationalNumber(parsed.nationalNumber);
  }, [value]);

  const selectedCountry = useMemo(
    () => COUNTRIES.find((item) => item.code === country) || COUNTRIES.find((item) => item.code === defaultCountry),
    [country, defaultCountry]
  );

  const emit = (nextCountry, nextNationalNumber) => {
    const digits = nextNationalNumber.replace(/\D/g, '');
    if (!digits) {
      onChange('');
      return;
    }
    onChange(`+${getCountryCallingCode(nextCountry)}${digits}`);
  };

  const selectCountry = (nextCountry) => {
    setCountry(nextCountry);
    setOpen(false);
    emit(nextCountry, nationalNumber);
  };

  const handleNumberChange = (event) => {
    const digits = event.target.value.replace(/\D/g, '').slice(0, 15);
    setNationalNumber(digits);
    emit(country, digits);
  };

  const formattedNationalNumber = nationalNumber
    ? new AsYouType(country).input(nationalNumber)
    : '';

  return (
    <div className="flex min-w-0 rounded-xl border border-white/10 bg-[#07101f]/80 shadow-inner shadow-black/10 focus-within:border-cyan-400/60 focus-within:ring-2 focus-within:ring-cyan-400/15">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            aria-label={`País do telefone: ${selectedCountry?.name}`}
            className="h-10 shrink-0 rounded-r-none border-r border-white/10 px-3 hover:bg-white/5"
          >
            <span aria-hidden="true" className="text-base">{selectedCountry?.flag}</span>
            <span className="ml-2 text-xs text-slate-300">{selectedCountry?.callingCode}</span>
            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" collisionPadding={16} className="w-[min(24rem,calc(100vw-2rem))] p-0">
          <Command>
            <CommandInput placeholder="Buscar país ou código..." aria-label="Buscar país do telefone" />
            <CommandList className="custom-scrollbar max-h-72">
              <CommandEmpty>Nenhum país encontrado.</CommandEmpty>
              <CommandGroup>
                {COUNTRIES.map((item) => (
                  <CommandItem
                    key={item.code}
                    value={`${item.name} ${item.code} ${item.callingCode}`}
                    onSelect={() => selectCountry(item.code)}
                    className="gap-3 py-2.5"
                  >
                    <span aria-hidden="true" className="w-6 text-lg">{item.flag}</span>
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    <span className="text-xs text-muted-foreground">{item.callingCode}</span>
                    <Check className={cn('h-4 w-4 text-cyan-300', country === item.code ? 'opacity-100' : 'opacity-0')} />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <div className="relative min-w-0 flex-1">
        <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          required={required}
          disabled={disabled}
          value={formattedNationalNumber}
          onChange={handleNumberChange}
          placeholder="DDD + número"
          className="h-10 rounded-l-none border-0 bg-transparent pl-10 shadow-none focus-visible:ring-0"
          aria-label="Número de telefone"
        />
      </div>
    </div>
  );
};

export default GovPhoneInput;
