import { HeartPulse, Utensils, Droplets, ShowerHead, Users, Moon, Smile } from 'lucide-react';

export const NEEDS = [
  { key: 'happiness', name: 'Felicidade', icon: Smile, color: 'bg-yellow-400', text: 'text-yellow-400' },
  { key: 'health', name: 'Saúde', icon: HeartPulse, color: 'bg-rose-500', text: 'text-rose-400' },
  { key: 'hunger', name: 'Fome', icon: Utensils, color: 'bg-orange-500', text: 'text-orange-400' },
  { key: 'thirst', name: 'Sede', icon: Droplets, color: 'bg-blue-500', text: 'text-blue-400' },
  { key: 'hygiene', name: 'Higiene', icon: ShowerHead, color: 'bg-cyan-500', text: 'text-cyan-400' },
  { key: 'social', name: 'Socialização', icon: Users, color: 'bg-purple-500', text: 'text-purple-400' },
  { key: 'sleep', name: 'Sono', icon: Moon, color: 'bg-indigo-500', text: 'text-indigo-400' },
];
