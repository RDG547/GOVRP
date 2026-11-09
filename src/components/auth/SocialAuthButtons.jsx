import React from 'react';
import { FcGoogle } from 'react-icons/fc';
import { FaDiscord, FaFacebookF } from 'react-icons/fa';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const providers = [
  {
    id: 'google', name: 'Google', icon: FcGoogle,
    className: 'border-[#dadce0] bg-white text-[#3c4043] hover:border-[#aecbfa] hover:bg-[#f8fafd] focus-visible:ring-[#4285f4]',
    labelClass: 'font-sans font-medium tracking-normal',
  },
  {
    id: 'facebook', name: 'Facebook', icon: FaFacebookF,
    className: 'border-[#1877f2] bg-[#1877f2] text-white hover:bg-[#166fe5] focus-visible:ring-[#1877f2]',
    labelClass: 'font-sans font-semibold tracking-normal',
  },
  {
    id: 'discord', name: 'Discord', icon: FaDiscord,
    className: 'border-[#5865f2] bg-[#5865f2] text-white hover:bg-[#4752c4] focus-visible:ring-[#5865f2]',
    labelClass: 'font-sans font-semibold tracking-normal',
  },
];

/** Official recognizable provider marks, without making external image requests. */
export default function SocialAuthButtons({ onSelect, disabled = false, loadingProvider = null }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Entrar com conta social">
      {providers.map(({ id, name, icon: Icon, className, labelClass }) => (
        <Button
          key={id}
          type="button"
          variant="outline"
          disabled={disabled || Boolean(loadingProvider)}
          onClick={() => onSelect(id)}
          aria-label={`Continuar com ${name}`}
          className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-3 transition-colors disabled:opacity-60 ${className}`}
        >
          {loadingProvider === id ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" /> : <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />}
          <span className={labelClass}>{name}</span>
        </Button>
      ))}
    </div>
  );
}
