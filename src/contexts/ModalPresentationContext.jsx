import React,{createContext} from 'react';
import {Check,CheckCircle2,X,XCircle,Trash2,Save,Send,ShoppingCart,CreditCard,HeartHandshake,ArrowLeft,Eye,Pencil,Plus,CalendarClock,FileCheck,Play,Search} from 'lucide-react';
import { AlignLeft, FileText, Calendar, Clock, Banknote, User, Briefcase, Scale, MapPin, Hash, Mail, Image, ShieldCheck, Building2, MessageSquare, Settings, Vote, Globe, ListChecks, Link2, Gavel, ArrowDownUp, Compass } from 'lucide-react';
import { AtSign, UserPlus, GraduationCap, Route, Layers, Armchair, Newspaper, Gauge, Target, Wine, Package, Sun, Type as TypeIcon, PieChart, LogOut, EyeOff } from 'lucide-react';
export const ModalPresentationContext=createContext(false);
const rules=[[/^(cancelar|fechar)/i,X,'outline'],[/^voltar/i,ArrowLeft,'outline'],[/^(excluir|remover|apagar)/i,Trash2,'destructive'],[/^salvar/i,Save],[/^(aceitar|aprovar|validar)/i,CheckCircle2],[/^(recusar|rejeitar|negar)/i,XCircle,'destructive'],[/^(confirmar|continuar|concluir)/i,Check],[/^(enviar|protocolar|publicar)/i,Send],[/^(comprar|adquirir)/i,ShoppingCart],[/^pagar/i,CreditCard],[/^(doar|doação)/i,HeartHandshake],[/^(ver|visualizar|consultar|conhecer)/i,Eye],[/^(editar|alterar|ajustar)/i,Pencil],[/^(criar|novo|nova|adicionar)/i,Plus],[/^(solicitar|requerer)/i,Send],[/^(revisar|analisar)/i,Search],[/^agendar/i,CalendarClock],[/^(emitir|registrar|gerar)/i,FileCheck],[/^(iniciar|abrir|executar|aplicar)/i,Play],[/^(buscar|pesquisar)/i,Search]];
const textOf=children=>React.Children.toArray(children).map(c=>typeof c==='string'?c:React.isValidElement(c)?textOf(c.props.children):'').join(' ').trim();
const hasIcon=children=>React.Children.toArray(children).some(c=>React.isValidElement(c)&&(c.type==='svg'||c.type?.render&&/\"svg\"|'svg'/.test(String(c.type.render))||hasIcon(c.props.children)));
export function modalAction(children){const match=rules.find(([pattern])=>pattern.test(textOf(children).replace(/^sim[, ]+/i,'')));return {variant:match?.[2],icon:match&&!hasIcon(children)?React.createElement(match[1],{'aria-hidden':true,className:'mr-2 h-4 w-4 shrink-0'}):null};}

const semantics = [
 [/não mostrar novamente/i, EyeOff, 'text-slate-400'],
 [/confirmo|digite para confirmar/i, CheckCircle2, 'text-emerald-400'],
 [/fonte da marca|tipografia/i, TypeIcon, 'text-pink-400'],
 [/username|@handle/i, AtSign, 'text-cyan-400'],
 [/filiação/i, UserPlus, 'text-violet-400'],
 [/qualifica|escolaridade|formaç/i, GraduationCap, 'text-amber-400'],
 [/etapa da jornada/i, Route, 'text-cyan-400'],
 [/cadeiras/i, Armchair, 'text-violet-400'],
 [/luminosidade/i, Sun, 'text-amber-400'],
 [/bebida alcoólica/i, Wine, 'text-rose-400'],
 [/estoque/i, Package, 'text-amber-400'],
 [/alocação visual/i, PieChart, 'text-violet-400'],
 [/saúde operacional|credibilidade/i, Gauge, 'text-emerald-400'],
 [/perfil editorial|veículo ativo|publicação de anúncios/i, Newspaper, 'text-rose-400'],
 [/estratégia|^alvo/i, Target, 'text-violet-400'],
 [/investigação policial/i, Search, 'text-cyan-400'],
 [/renunciar/i, LogOut, 'text-amber-400'],
 [/nível mínimo|setor|classifica/i, Layers, 'text-indigo-400'],
 [/operação|retirar oferta/i, ArrowDownUp, 'text-emerald-400'],
 [/urgência|prioridade/i, ShieldCheck, 'text-amber-400'],
 [/ideologia|orientação/i, Compass, 'text-violet-400'],
 [/regime|pena|crime|tipo penal|sentença/i, Gavel, 'text-violet-400'],
 [/link|url|website/i, Link2, 'text-sky-400'],
 [/ordenar|ordem/i, ArrowDownUp, 'text-sky-400'],
 [/quantidade|itens|item|parcelas/i, ListChecks, 'text-indigo-400'],
 [/senha|segurança|permiss|acesso/i, ShieldCheck, 'text-amber-400'],
 [/imagem|foto|capa|avatar/i, Image, 'text-pink-400'],
 [/email|e-mail/i, Mail, 'text-cyan-400'],
 [/horário|hora|duração|intervalo|quando ocorreu|^\s*\(brasília\)\s*$/i, Clock, 'text-amber-400'],
 [/data|prazo|vencimento|vigência|calendário|nascimento|início|encerramento|fim da|dias reais/i, Calendar, 'text-amber-400'],
 [/cartão|bandeira/i, CreditCard, 'text-emerald-400'],
 [/valor|saldo|limite|taxa|imposto|preço|multa|pagamento|fatura|crédito|financeir|banco|balanço|cartão|bandeira|moeda|salário|orçamento|promoção/i, Banknote, 'text-emerald-400'],
 [/cargo|função|carreira|atividade|profissão|vagas|posições/i, Briefcase, 'text-violet-400'],
 [/cidadão|usuário|titular|destinatário|responsável|parlamentar|pessoa|dono|presidente|remetente|envolvid|suspeito|testemunha|acusado|investigado|condenado|cônjuge|gestor|agente relacionado|vender como|enviar para/i, User, 'text-cyan-400'],
 [/local|endereço|região|estado|cidade|destino/i, MapPin, 'text-orange-400'],
 [/país|nacionalidade/i, Globe, 'text-cyan-400'],
 [/número|código|identifica|sigla|cpf|^id$/i, Hash, 'text-sky-400'],
 [/empresa|imóvel|hospital|ministério/i, Building2, 'text-cyan-400'],
 [/eleiç|votaç|candidat/i, Vote, 'text-teal-400'],
 [/justifica|fundament|processo|sentença|judicial|lei|norma|stf|motivo|fatos|fato e resultado|finalidade institucional/i, Scale, 'text-violet-400'],
 [/resumo|ementa/i, AlignLeft, 'text-sky-400'],
 [/descriç|texto|artigo|conteúdo|documento|título|nome|relatório|detalhes|estatuto|referências|prova|trecho|objetivo|assunto|manifesto|sugestão|biografia|^\s*bio\s*$|propostas|responsabilidades|finalidade do uso|edital|pdf/i, FileText, 'text-sky-400'],
 [/mensagem|pergunta|resposta|manifesta/i, MessageSquare, 'text-cyan-400'],
 [/configura|política|preferência/i, Settings, 'text-violet-400'],
 [/tipo|categoria|status|situação|opç|escopo/i, ListChecks, 'text-indigo-400'],
];
export function modalSemanticIcon(children, { heading = false, hint = '' } = {}) {
 if (hasIcon(children)) return null;
 const text = `${hint} ${textOf(children)}`;
 if(heading&&/excluir|remover|apagar|cancelar definitivamente/i.test(text))return <Trash2 aria-hidden="true" className="mr-2 inline-block h-6 w-6 shrink-0 text-red-400"/>;
 const rule = semantics.find(([pattern]) => pattern.test(text));
 if (!rule && !heading) return null;
 const Icon = rule?.[1] || FileText;
 return <Icon aria-hidden="true" className={`${heading ? 'h-6 w-6' : 'h-4 w-4'} mr-2 inline-block shrink-0 align-middle ${rule?.[2] || 'text-sky-400'}`}/>;
}
