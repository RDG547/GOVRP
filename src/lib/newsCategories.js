import { Newspaper, Landmark, UserCheck, Gavel, TrendingUp, Shield, Users, Briefcase, HeartPulse, GraduationCap, Globe, FileText } from 'lucide-react';
const key = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[_-]/g, ' ').trim().toLowerCase();
const categories = [
  { name:'Nomeações', match:/nomea|appointment/, icon:UserCheck, color:'text-cyan-500' },
  { name:'Economia', match:/econom|financ|tax|tribut|imposto/, icon:TrendingUp, color:'text-emerald-500' },
  { name:'Justiça', match:/justi|judic|senten|justice/, icon:Gavel, color:'text-purple-500' },
  { name:'Segurança', match:/segur|polic|security/, icon:Shield, color:'text-sky-500' },
  { name:'Política', match:/politi|eleic|election|govern/, icon:Landmark, color:'text-blue-500' },
  { name:'Sociedade', match:/socie|civil|popul/, icon:Users, color:'text-orange-500' },
  { name:'Empresas', match:/empres|business|comerc/, icon:Briefcase, color:'text-amber-500' },
  { name:'Saúde', match:/saude|health/, icon:HeartPulse, color:'text-red-500' },
  { name:'Educação', match:/educa|carreira/, icon:GraduationCap, color:'text-violet-500' },
  { name:'Internacional', match:/internac|global|diplom/, icon:Globe, color:'text-teal-500' },
  { name:'Diário Oficial', match:/diario|decreto|norma|legis|lei|oficial/, icon:FileText, color:'text-indigo-500' },
];
export const newsCategory = value => categories.find(category => category.match.test(key(value))) || { name:value || 'Notícias', icon:Newspaper, color:'text-rose-500' };
