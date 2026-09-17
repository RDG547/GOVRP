import { Crown, Shield, UserCheck, Users, Flag } from 'lucide-react';
export const politicalOrientations = ['Extrema Esquerda','Esquerda','Centro-Esquerda','Centro','Centro-Direita','Direita','Extrema-Direita'];
export const orientationColors = {
  'Extrema Esquerda':'bg-red-900 hover:bg-red-800 text-white',
  'Esquerda':'bg-red-600 hover:bg-red-500 text-white',
  'Centro-Esquerda':'bg-red-400 hover:bg-red-300 text-black',
  'Centro':'bg-gray-500 hover:bg-gray-400 text-white',
  'Centro-Direita':'bg-blue-500 hover:bg-blue-400 text-white',
  'Direita':'bg-blue-600 hover:bg-blue-500 text-white',
  'Extrema-Direita':'bg-blue-900 hover:bg-blue-800 text-white',
  'Extrema Direita':'bg-blue-900 hover:bg-blue-800 text-white',
  'Não definido':'bg-gray-700 hover:bg-gray-600 text-white',
};
export const partyRoleIdentity = role => ({
  Dono:{icon:Crown,color:'text-amber-400'},
  Presidente:{icon:Shield,color:'text-blue-400'},
  'Vice-Presidente':{icon:UserCheck,color:'text-cyan-400'},
  Fundador:{icon:Flag,color:'text-purple-400'},
  Membro:{icon:Users,color:'text-emerald-400'},
}[role] || {icon:Users,color:'text-emerald-400'});
export const partyRoles = (party,userId) => [['owner_id','Dono'],['president_id','Presidente'],['vice_president_id','Vice-Presidente']].filter(([field])=>party[field]===userId).map(([,role])=>role);
