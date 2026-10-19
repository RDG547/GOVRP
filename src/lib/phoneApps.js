import {BatteryFull,Briefcase,Circle,HeartPulse,Home,Landmark,LineChart,MessageSquare,Newspaper,Phone,Signal,Smartphone,Square,Store,Triangle,Wifi,X} from 'lucide-react';
export const PHONE_APPS = [
  ['Banco', '/services/bank', Landmark, 'bg-emerald-600'],
  ['X', '/services/x', MessageSquare, 'bg-slate-900'],
  ['Negócios Livre', '/services/business', Store, 'bg-blue-600'],
  ['Internet', '/services/internet', Wifi, 'bg-cyan-700'],
  ['Telefonia', '/services/phone', Phone, 'bg-violet-600'],
  ['Moradia', '/services/national-housing', Home, 'bg-emerald-700'],
  ['Portal do Trabalhador', '/services/my-work', Briefcase, 'bg-amber-700'],
  ['Notícias', '/news', Newspaper, 'bg-rose-600'],
  ['SNS', '/services/health', HeartPulse, 'bg-red-600'],
  ['Bolsa de Valores', '/services/stock-exchange', LineChart, 'bg-indigo-600'],
];
export function phoneNotificationApp(n){if(!n.link)return null;let url;try{url=new URL(n.link,'https://govrp.invalid');}catch{return null;}if(url.origin!=='https://govrp.invalid')return null;return PHONE_APPS.find(app=>url.pathname===app[1]||url.pathname.startsWith(app[1]+'/'))||null;}
