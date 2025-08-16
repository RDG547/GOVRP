import React, { useState } from 'react';
import QRCode from 'qrcode.react';
import { formatCPF, formatRG } from '@/lib/utils';
import { Fingerprint, FileText, Car, Globe, Building, Briefcase, Vote, ShieldCheck, Heart, Award, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const docInfo = {
    CPF: { name: 'Cadastro de Pessoa Física', icon: Fingerprint, color: 'text-purple-400' },
    RG: { name: 'Registro Geral', icon: FileText, color: 'text-purple-400' },
    CNH: { name: 'Carteira Nacional de Habilitação', icon: Car, color: 'text-blue-400' },
    Passport: { name: 'Passaporte', icon: Globe, color: 'text-green-400' },
    CNPJ: { name: 'Cadastro Nacional da Pessoa Jurídica', icon: Building, color: 'text-yellow-400' },
    CTD: { name: 'Carteira de Trabalho Digital', icon: Briefcase, color: 'text-indigo-400' },
    'Título de Eleitor': { name: 'Título de Eleitor', icon: Vote, color: 'text-teal-400' },
    'Certificado de Reservista': { name: 'Certificado de Reservista', icon: ShieldCheck, color: 'text-orange-400' },
    'Certidão de Casamento': { name: 'Certidão de Casamento', icon: Heart, color: 'text-pink-400' },
    'Registro Profissional': { name: 'Registro Profissional', icon: Award, color: 'text-cyan-400' },
};

const formatValue = (type, value) => {
    if (type === 'CPF') return formatCPF(value);
    if (type === 'RG') return formatRG(value);
    return value;
};

const DocumentField = ({ label, value, className = '' }) => (
    <div className={className}>
        <p className="block font-semibold text-gray-500 uppercase tracking-wider text-[0.5rem] sm:text-[9px] leading-tight">{label}</p>
        <p className="font-bold text-[0.6rem] sm:text-[12px] leading-tight truncate">{value || 'N/A'}</p>
    </div>
);

const DocumentContainer = ({ children, className = '' }) => (
    <div className={`relative w-full max-w-[420px] aspect-[1.6] flex flex-col shadow-lg border rounded-lg p-2 sm:p-4 ${className}`}>
        {children}
    </div>
);

const RGDocument = ({ user, doc, side }) => (
    <DocumentContainer className="bg-gradient-to-br from-gray-100 to-blue-50 text-black font-sans">
        {side === 'front' ? (
            <>
                <header className="flex items-center justify-between pb-1 sm:pb-2 border-b-2 border-black">
                    <h1 className="font-bold text-[0.6rem] sm:text-base">REPÚBLICA FEDERATIVA DE GOV.RP</h1>
                    <img src="/gov-logo.png" alt="Selo" className="w-8 h-8 sm:w-12 sm:h-12"/>
                </header>
                <p className="text-center font-semibold text-[0.5rem] sm:text-sm mt-1 sm:mt-2">SECRETARIA DE SEGURANÇA PÚBLICA</p>
                <p className="text-center font-bold text-[0.8rem] sm:text-xl">CARTEIRA DE IDENTIDADE</p>
                <main className="flex-grow flex gap-2 sm:gap-3 mt-1 sm:mt-3">
                    <div className="w-1/4 flex flex-col items-center justify-between">
                        <img src={user.avatar_url} alt="Foto" className="w-full aspect-[3/4] object-cover border-2 border-gray-400"/>
                        <p className="text-[0.4rem] sm:text-[9px] mt-1 text-center">POLEGAR DIREITO</p>
                    </div>
                    <div className="w-3/4 space-y-1 sm:space-y-1.5 text-[0.5rem] sm:text-[11px] p-1">
                        <DocumentField label="REGISTRO GERAL" value={formatRG(doc.document_number)} className="text-red-600 font-mono" />
                        <DocumentField label="DATA DE EXPEDIÇÃO" value={new Date(doc.issued_at).toLocaleDateString('pt-BR')} />
                        <DocumentField label="NOME" value={user.full_name?.toUpperCase()} />
                        <DocumentField label="FILIAÇÃO" value="NÃO INFORMADO" />
                        <DocumentField label="NATURALIDADE" value="LOS SANTOS - RP" />
                        <DocumentField label="DATA NASC." value={new Date(user.date_of_birth).toLocaleDateString('pt-BR')} />
                        <DocumentField label="DOC. ORIGEM" value="N/A" />
                        <DocumentField label="CPF" value={formatCPF(user.cpf)} />
                    </div>
                </main>
            </>
        ) : (
            <div className="w-full h-full flex flex-col justify-center items-center">
                <p className="font-bold text-lg sm:text-xl">VÁLIDO EM TODO</p>
                <p className="font-bold text-lg sm:text-xl">TERRITÓRIO NACIONAL</p>
                <div className="h-px bg-black w-2/3 my-2 sm:my-3"></div>
                <p className="text-[0.6rem] sm:text-sm">LEI Nº 7.116, DE 29 DE AGOSTO DE 1983</p>
            </div>
        )}
    </DocumentContainer>
);

const CPFDocument = ({ user, doc }) => (
    <DocumentContainer className="bg-gradient-to-br from-blue-50 to-green-50 text-black font-sans justify-between">
        <header className="flex items-center justify-between">
            <div className="flex items-center gap-2">
                <img src="/gov-logo.png" alt="Selo" className="w-8 h-8 sm:w-12 sm:h-12"/>
                <div>
                    <p className="text-[0.5rem] sm:text-sm font-bold">REPÚBLICA FEDERATIVA DE GOV.RP</p>
                    <p className="text-[0.4rem] sm:text-xs">MINISTÉRIO DA FAZENDA</p>
                    <p className="text-[0.4rem] sm:text-xs">SECRETARIA DA RECEITA FEDERAL</p>
                </div>
            </div>
            <p className="font-bold text-lg sm:text-xl">CPF</p>
        </header>
        <main className="text-center">
            <p className="text-[0.6rem] sm:text-sm">NÚMERO DE INSCRIÇÃO</p>
            <p className="font-mono font-bold text-2xl sm:text-4xl tracking-wider">{formatCPF(doc.document_number)}</p>
            <p className="text-[0.6rem] sm:text-sm mt-1 sm:mt-2">NOME</p>
            <p className="font-semibold text-lg sm:text-2xl truncate">{user.full_name?.toUpperCase()}</p>
            <p className="text-[0.6rem] sm:text-sm mt-1 sm:mt-2">DATA DE NASCIMENTO</p>
            <p className="font-semibold text-base sm:text-xl">{new Date(user.date_of_birth).toLocaleDateString('pt-BR')}</p>
        </main>
        <footer className="text-right text-[0.5rem] sm:text-xs">
            <p>EMISSÃO: {new Date(doc.issued_at).toLocaleDateString('pt-BR')}</p>
        </footer>
    </DocumentContainer>
);

const CNPJDocument = ({ user, doc }) => (
    <DocumentContainer className="bg-white text-black font-sans justify-between">
        <header className="text-center border-b-2 border-black pb-1 sm:pb-2">
            <p className="text-[0.5rem] sm:text-sm font-bold">REPÚBLICA FEDERATIVA DE GOV.RP</p>
            <p className="text-base sm:text-xl font-bold">CADASTRO NACIONAL DA PESSOA JURÍDICA</p>
        </header>
        <main className="space-y-1 sm:space-y-1.5 text-[0.6rem] sm:text-sm">
            <DocumentField label="NÚMERO DE INSCRIÇÃO" value={doc.document_number} />
            <DocumentField label="DATA DE ABERTURA" value={new Date(doc.issued_at).toLocaleDateString('pt-BR')} />
            <DocumentField label="NOME EMPRESARIAL" value={doc.metadata?.company_name?.toUpperCase() || 'N/A'} />
            <DocumentField label="TÍTULO DO ESTABELECIMENTO (NOME DE FANTASIA)" value={doc.metadata?.company_name?.toUpperCase() || 'N/A'} />
            <DocumentField label="CÓDIGO E DESCRIÇÃO DA ATIVIDADE ECONÔMICA PRINCIPAL" value="96.09-2-99 - OUTRAS ATIVIDADES DE SERVIÇOS PESSOAIS" />
            <DocumentField label="ENDEREÇO" value="LOS SANTOS, RP" />
            <DocumentField label="SITUAÇÃO CADASTRAL" value="ATIVA" />
        </main>
        <footer className="text-center text-[0.4rem] sm:text-[10px]">
            <p>Aprovado pela Instrução Normativa RFB nº 1.863, de 27 de dezembro de 2018.</p>
        </footer>
    </DocumentContainer>
);

const CTDDocument = ({ user, doc, side }) => (
    <DocumentContainer className="bg-[#0A2240] text-white font-sans">
        {side === 'front' ? (
            <div className="w-full h-full flex flex-col justify-between">
                <header className="flex items-center justify-between">
                    <img src="/gov-logo.png" alt="Brasão" className="w-10 h-10 sm:w-14 sm:h-14" />
                    <div className="text-right">
                        <p className="font-bold text-base sm:text-xl">CARTEIRA DE TRABALHO</p>
                        <p className="text-[0.6rem] sm:text-sm">E PREVIDÊNCIA SOCIAL</p>
                    </div>
                </header>
                <main className="flex items-center gap-2 sm:gap-4">
                    <img src={user.avatar_url} alt="Foto" className="w-1/4 aspect-[3/4] object-cover border-2 border-white"/>
                    <div className="text-[0.6rem] sm:text-sm flex-1 space-y-1">
                        <DocumentField label="NOME" value={user.full_name?.toUpperCase()} className="text-white" />
                        <DocumentField label="NASCIMENTO" value={new Date(user.date_of_birth).toLocaleDateString('pt-BR')} className="text-white" />
                        <DocumentField label="CPF" value={formatCPF(user.cpf)} className="text-white" />
                    </div>
                </main>
                <footer className="flex justify-between items-end">
                    <div className="text-[0.6rem] sm:text-sm">
                        <p>Nº: {doc.document_number.split(' ')[0]}</p>
                        <p>Série: {doc.document_number.split(' ')[1]}</p>
                    </div>
                    <p className="font-serif text-base sm:text-xl">Assinatura do Portador</p>
                </footer>
            </div>
        ) : (
            <div className="w-full h-full flex flex-col justify-between text-[0.6rem] sm:text-sm">
                <p className="font-bold text-center text-lg">CONTRATO DE TRABALHO</p>
                <div className="border-t border-b border-white/50 py-2 sm:py-3 space-y-1 sm:space-y-2">
                    <DocumentField label="EMPREGADOR" value="GOVERNO DE RP" className="text-white" />
                    <DocumentField label="FUNÇÃO" value={user.occupation || 'NÃO ESPECIFICADO'} className="text-white" />
                    <DocumentField label="DATA DE ADMISSÃO" value={new Date(doc.issued_at).toLocaleDateString('pt-BR')} className="text-white" />
                </div>
                <p className="text-[0.5rem] sm:text-xs text-center">Este documento substitui a CTPS física. Válido em todo território nacional.</p>
            </div>
        )}
    </DocumentContainer>
);

const TituloEleitorDocument = ({ user, doc }) => (
    <DocumentContainer className="bg-white text-black font-mono">
        <header className="flex items-center justify-between border-b-2 border-black pb-1 sm:pb-2">
            <div className="flex items-center gap-2 sm:gap-3">
                <img src="/gov-logo.png" alt="Selo" className="w-8 h-8 sm:w-12 sm:h-12"/>
                <p className="font-bold text-base sm:text-lg">JUSTIÇA ELEITORAL</p>
            </div>
            <Vote className="w-8 h-8 sm:w-10 sm:h-10" />
        </header>
        <main className="flex-grow flex items-center justify-between mt-2 sm:mt-3">
            <div className="w-2/3 space-y-2 sm:space-y-2.5 text-[0.6rem] sm:text-sm">
                <DocumentField label="NÚMERO DE INSCRIÇÃO" value={doc.document_number} />
                <DocumentField label="NOME" value={user.full_name?.toUpperCase()} />
                <div className="flex gap-4 sm:gap-6">
                    <DocumentField label="DATA NASC." value={new Date(user.date_of_birth).toLocaleDateString('pt-BR')} />
                    <DocumentField label="ZONA" value="001" />
                    <DocumentField label="SEÇÃO" value="0001" />
                </div>
                <DocumentField label="MUNICÍPIO" value="LOS SANTOS - RP" />
                <DocumentField label="DATA DE EMISSÃO" value={new Date(doc.issued_at).toLocaleDateString('pt-BR')} />
            </div>
            <div className="w-1/3 flex flex-col items-center">
                <QRCode value={doc.qr_code_data || 'gov.rp'} size={64} />
                <p className="text-[0.4rem] sm:text-[10px] mt-2 text-center">Este documento é válido e substitui o título de eleitor físico.</p>
            </div>
        </main>
    </DocumentContainer>
);

const CNHDocument = ({ user, doc, side }) => (
    <DocumentContainer className="bg-gradient-to-br from-green-100 to-blue-100 text-black font-mono">
        {side === 'front' ? (
            <>
                <header className="flex items-center justify-between pb-1">
                    <div className="flex items-center gap-2">
                         <img src="/gov-logo.png" alt="Selo" className="w-8 h-8 sm:w-10 sm:h-10"/>
                         <div className="text-[0.5rem] sm:text-[10px] leading-tight"><p>REPÚBLICA FEDERATIVA</p><p className="font-bold">DE GOV.RP</p><p>MINISTÉRIO DA JUSTIÇA</p></div>
                    </div>
                    <h1 className="font-bold text-[0.6rem] sm:text-sm text-right">CARTEIRA NACIONAL<br/>DE HABILITAÇÃO</h1>
                </header>
                <div className="flex-grow flex gap-2 sm:gap-3 mt-1 sm:mt-2">
                    <div className="w-1/4 flex flex-col items-center justify-start">
                        <img src={user.avatar_url} alt="Foto" className="w-full aspect-[3/4] object-cover border-2 border-gray-400"/>
                    </div>
                    <div className="w-3/4 space-y-1 sm:space-y-1.5 text-[0.5rem] sm:text-[11px] bg-white/30 p-1 sm:p-2 rounded">
                        <DocumentField label="NOME" value={user.full_name?.toUpperCase()} />
                        <div className="flex justify-between gap-2">
                            <DocumentField label="DOC. IDENTIDADE / ORG. EMISSOR" value={`${formatRG(user.rg)} SSP/RP`} />
                            <DocumentField label="CPF" value={formatCPF(user.cpf)} />
                        </div>
                        <div className="flex justify-between">
                            <DocumentField label="DATA NASC." value={new Date(user.date_of_birth).toLocaleDateString('pt-BR')} />
                            <DocumentField label="CATEGORIA" value="AB" />
                        </div>
                        <DocumentField label="N° REGISTRO" value={doc.document_number} />
                        <div className="flex justify-between">
                            <DocumentField label="VALIDADE" value={doc.expires_at ? new Date(doc.expires_at).toLocaleDateString('pt-BR') : 'INDEFINIDA'} />
                            <DocumentField label="1ª HABILITAÇÃO" value={new Date(doc.issued_at).toLocaleDateString('pt-BR')} />
                        </div>
                    </div>
                </div>
                <footer className="flex items-end justify-between mt-1 sm:mt-2">
                    <p className="text-[0.5rem] sm:text-[10px] leading-tight -space-y-1">ASSINATURA DO<br/>PORTADOR</p>
                    <QRCode value={doc.qr_code_data || 'gov.rp'} size={32} bgColor="#00000000" fgColor="#000000" level="L" />
                </footer>
            </>
        ) : (
             <div className="w-full h-full flex flex-col justify-between">
                 <div className="flex justify-between items-start">
                    <p className="text-[0.5rem] sm:text-xs text-gray-600">OBSERVAÇÕES</p>
                    <p className="text-right text-[0.5rem] sm:text-xs text-gray-600">LOCAL DE EMISSÃO<br/><span className="font-bold text-black">Los Santos, RP</span></p>
                 </div>
                 <div className="text-center">
                    <p className="text-[0.6rem] sm:text-sm font-bold">ASSINATURA DO EMISSOR</p>
                    <p className="font-serif text-lg sm:text-xl -mt-1">Assinatura Digital</p>
                 </div>
                 <div className="h-3 sm:h-5 bg-gray-300 w-full"></div>
             </div>
        )}
    </DocumentContainer>
);

const PassportDocument = ({ user, doc, side }) => (
     <DocumentContainer className={`font-serif ${side === 'front' ? 'bg-[#0A2240] text-white' : 'bg-gray-100 text-black'}`}>
        {side === 'front' ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-center">
                <img src="/gov-logo.png" alt="Brasão" className="w-12 h-12 sm:w-20 sm:h-20 mb-2 sm:mb-3" />
                <p className="text-[0.6rem] sm:text-lg tracking-[0.2em]">REPÚBLICA FEDERATIVA DE GOV.RP</p>
                <div className="w-2/3 h-px bg-white/50 my-2 sm:my-4"></div>
                <p className="text-xl sm:text-3xl font-bold tracking-wider">PASSAPORTE</p>
            </div>
        ) : (
            <div className="flex flex-col justify-between h-full">
                 <div>
                    <p className="text-[0.6rem] sm:text-sm text-gray-500 tracking-widest">PASSAPORTE</p>
                    <div className="flex gap-2 sm:gap-4 mt-1 sm:mt-2">
                        <img src={user.avatar_url} alt="Foto" className="w-1/4 aspect-[3/4] object-cover"/>
                        <div className="text-[0.5rem] sm:text-xs w-full grid grid-cols-2 gap-x-2 sm:gap-x-3 gap-y-1 sm:gap-y-1.5">
                            <DocumentField label="Tipo/Type" value="P" />
                            <DocumentField label="País/Country" value="GOV" />
                            <DocumentField label="Passaporte Nº" value={doc.document_number} className="col-span-2"/>
                            <DocumentField label="Apelido/Surname" value={user.full_name?.split(' ').slice(-1).join(' ').toUpperCase()} className="col-span-2"/>
                            <DocumentField label="Nomes/Given Names" value={user.full_name?.split(' ').slice(0, -1).join(' ').toUpperCase()} className="col-span-2"/>
                            <DocumentField label="Nacionalidade" value="GOVERNIANA" />
                            <DocumentField label="Data de Nasc." value={new Date(user.date_of_birth).toLocaleDateString('pt-BR')} />
                            <DocumentField label="Data de Emissão" value={new Date(doc.issued_at).toLocaleDateString('pt-BR')} />
                            <DocumentField label="Data de Validade" value={doc.expires_at ? new Date(doc.expires_at).toLocaleDateString('pt-BR') : 'INDEFINIDA'} />
                        </div>
                    </div>
                 </div>
                 <div className="font-mono text-[0.5rem] sm:text-sm tracking-wider leading-tight mt-auto">
                    <p>{`P<GOV<${user.full_name?.toUpperCase().replace(/ /g, '<').padEnd(30, '<')}`}</p>
                    <p>{`${doc.document_number}<1GOV${new Date(user.date_of_birth).getFullYear()}${(new Date(user.date_of_birth).getMonth()+1).toString().padStart(2, '0')}${new Date(user.date_of_birth).getDate().toString().padStart(2, '0')}<1M${doc.expires_at ? `${new Date(doc.expires_at).getFullYear()}${(new Date(doc.expires_at).getMonth()+1).toString().padStart(2, '0')}${new Date(doc.expires_at).getDate().toString().padStart(2, '0')}` : '<<<<<<'}`.padEnd(30, '<')}</p>
                 </div>
            </div>
        )}
    </DocumentContainer>
);


export const OfficialDocument = ({ user, doc, onBack, side: initialSide = 'front' }) => {
  const info = docInfo[doc.type];
  const [side, setSide] = useState(initialSide);

  if (!info || !user) return null;

  const DocumentComponent = {
      CNH: CNHDocument,
      Passport: PassportDocument,
      RG: RGDocument,
      CPF: CPFDocument,
      CNPJ: CNPJDocument,
      CTD: CTDDocument,
      'Título de Eleitor': TituloEleitorDocument,
  }[doc.type];

  const hasTwoSides = ['CNH', 'RG', 'CTD', 'Passport'].includes(doc.type);

  return (
    <div className="relative w-full max-w-md mx-auto">
      {DocumentComponent ? <DocumentComponent user={user} doc={doc} side={side}/> : <DefaultDocument user={user} doc={doc} info={info} />}
       {onBack && (
        <div className="absolute top-2 right-2 flex flex-col gap-2">
           <Button variant="ghost" size="icon" onClick={onBack} className="text-white bg-black/50 hover:bg-black/70 h-8 w-8"><X className="h-4 w-4"/></Button>
           {hasTwoSides && <Button variant="ghost" size="icon" onClick={() => setSide(s => s === 'front' ? 'back' : 'front')} className="text-white bg-black/50 hover:bg-black/70 h-8 w-8"><RefreshCw className="h-4 w-4"/></Button>}
        </div>
       )}
    </div>
  )
};

const DefaultDocument = ({ user, doc, info }) => (
    <DocumentContainer className="bg-white text-black font-sans">
        <header className="flex items-center justify-between border-b-2 border-gray-400 pb-2">
            <div className="flex items-center gap-2"><img src="/gov-logo.png" alt="Selo" className="w-10 h-10"/><h1 className="font-bold text-sm">REP. FED. DE GOV.RP</h1></div>
            <info.icon className={`w-6 h-6 ${info.color}`} />
        </header>
        <main className="flex-grow mt-2 flex gap-4">
            <div className="w-1/4 flex flex-col items-center"><img src={user.avatar_url} alt="Foto" className="w-16 h-20 object-cover border-2 border-gray-300"/></div>
            <div className="w-3/4 space-y-1 text-xs">
                <DocumentField label="Nome Completo" value={user.full_name} />
                <div className="flex gap-4">
                    <DocumentField label={doc.type} value={formatValue(doc.type, doc.document_number)} />
                    <DocumentField label="Emissão" value={new Date(doc.issued_at).toLocaleDateString('pt-BR')} />
                </div>
            </div>
        </main>
    </DocumentContainer>
);