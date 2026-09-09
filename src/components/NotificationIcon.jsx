import React from 'react';
import { Info, CreditCard, Coins, Receipt, Landmark, Users, Vote, Gavel, Shield, MessageCircle, Newspaper, Briefcase, Home, HeartPulse, DollarSign } from 'lucide-react';
import { roleIcon } from '@/lib/roleIcons';

export default function NotificationIcon({ notification, className = 'h-5 w-5 shrink-0 text-primary' }) {
  const type = notification.type || '';
  const Icon = type === 'role_changed' ? roleIcon(notification.metadata?.new_role) :
    /card.*invoice|invoice/.test(type) ? Receipt : /card|credit/.test(type) ? CreditCard : /loan/.test(type) ? Coins :
    /party/.test(type) ? Users : /election|vote/.test(type) ? Vote : /justice|case|sentence|appeal/.test(type) ? Gavel :
    /police|warrant|investigation/.test(type) ? Shield : /x_|social/.test(type) ? MessageCircle :
    /news|media/.test(type) ? Newspaper : /business|company/.test(type) ? Briefcase : /housing|property/.test(type) ? Home :
    /need|health/.test(type) ? HeartPulse : /bank/.test(type) ? Landmark : /payment|money|transfer|tax|benefit/.test(type) ? DollarSign : Info;
  return <Icon aria-hidden="true" className={className} />;
}
