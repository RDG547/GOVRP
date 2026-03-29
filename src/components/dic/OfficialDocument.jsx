import React, { useState, useMemo } from 'react';
import QRCode from 'qrcode.react';
import { formatCPF, formatRG } from '@/lib/utils';
import { Fingerprint, FileText, Car, Globe, Building, Briefcase, Vote, ShieldCheck, Heart, Award, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const SEAL_IMAGE = 'https://horizons-cdn.hostinger.com/1921e16b-eda9-4d20-a26b-e282c5e34dc7/4a2eff68aee7768164d8f132c8123573.png';

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

const normalizeMrzValue = (value = '') =>
    value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9 ]/g, ' ')
        .trim();

const formatPassportMrzDate = (value) => {
    if (!value) return '<<<<<<';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '<<<<<<';

    const year = String(date.getFullYear()).slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}${month}${day}`;
};

const buildMrzLine = (value) =>
    value
        .replace(/\s+/g, '<')
        .replace(/<+/g, '<')
        .padEnd(44, '<')
        .slice(0, 44);

const getPassportNames = (fullName = '') => {
    const normalized = normalizeMrzValue(fullName);
    if (!normalized) {
        return {
            surname: 'N/A',
            givenNames: 'N/A',
        };
    }

    const parts = normalized.split(' ').filter(Boolean);
    if (parts.length === 1) {
        return {
            surname: parts[0],
            givenNames: 'N/A',
        };
    }

    return {
        surname: parts.slice(-1).join(' '),
        givenNames: parts.slice(0, -1).join(' '),
    };
};

const PassportField = ({ label, value, className = '' }) => (
    <div className={className}>
        <p className="block font-semibold text-slate-500 uppercase tracking-[0.18em] text-[0.44rem] sm:text-[0.55rem] leading-tight">
            {label}
        </p>
        <p className="font-bold text-slate-950 text-[0.58rem] sm:text-[0.76rem] leading-snug break-words">
            {value || 'N/A'}
        </p>
    </div>
);

const DocumentField = ({ label, value, className = '' }) => (
    <div className={className}>
        <p className="block font-semibold text-gray-500 uppercase tracking-wider text-[0.5rem] sm:text-[9px] leading-tight">{label}</p>
        <p className="font-bold text-black text-[0.6rem] sm:text-[12px] leading-snug break-words">{value || 'N/A'}</p>
    </div>
);

const DocumentContainer = ({ children, className = '' }) => (
    <div className={`relative w-full max-w-[430px] min-h-[280px] h-auto flex flex-col overflow-hidden shadow-lg border rounded-lg p-3 sm:p-4 ${className}`}>
        <div className="relative z-10 flex h-full flex-col">
            {children}
        </div>
    </div>
);

const FingerprintSVG = ({ seed }) => {
    const paths = useMemo(() => {
        let str = String(seed || 'default');
        const result = [];
        for (let i = 0; i < 15; i++) {
            str = str.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0).toString();
            // Pad the string to ensure we always have enough characters
            const padded = str.padEnd(12, '0');
            const p1 = parseInt(padded.substring(0, 2), 10) || 0;
            const p2 = parseInt(padded.substring(2, 4), 10) || 0;
            const p3 = parseInt(padded.substring(4, 6), 10) || 0;
            const p4 = parseInt(padded.substring(6, 8), 10) || 0;
            const p5 = parseInt(padded.substring(8, 10), 10) || 0;
            const p6 = parseInt(padded.substring(10, 12), 10) || 0;
            const d = `M ${20 + (p1 % 100)/5} ${10 + (p2 % 100)/2} C ${p3 % 100} ${(p4 % 100)/2}, ${100-(p5 % 100)} ${(p6 % 100)/2}, ${30 + (p1 % 100)/5} ${80 + (p2 % 100)/2}`;
            result.push(d);
        }
        return result;
    }, [seed]);

    return (
        <svg viewBox="0 0 100 100" className="w-full h-full">
            {paths.map((d, i) => (
                <path key={i} d={d} stroke="black" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            ))}
        </svg>
    );
};

const GenericBackSide = ({ doc }) => (
    <div className="w-full h-full flex flex-col justify-between items-center bg-gray-100 p-4">
        <div className="w-full h-8 bg-gray-300"></div>
        <QRCode value={doc.qr_code_data || 'gov.rp'} size={64} renderAs="svg" />
        <p className="text-center text-black text-[0.5rem] sm:text-xs">Este documento é pessoal e intransferível. Válido em todo o território nacional.</p>
        <div className="w-full h-8 bg-gray-300"></div>
    </div>
);

const RGDocument = ({ user, doc, side }) => {
    const dateOfBirth = new Date(user.date_of_birth.replace(/-/g, '\/')).toLocaleDateString('pt-BR');
    return (
    <DocumentContainer className="bg-gradient-to-br from-gray-100 to-blue-50 text-black font-sans">
        {side === 'front' ? (
            <>
                <header className="flex items-center justify-between pb-1 sm:pb-2 border-b-2 border-black">
                    <h1 className="font-bold text-[0.6rem] sm:text-base">REPÚBLICA FEDERATIVA DE GOV.RP</h1>
                    <img src={SEAL_IMAGE} alt="Selo" className="w-8 h-8 sm:w-12 sm:h-12 object-contain"/>
                </header>
                <p className="text-center font-semibold text-[0.5rem] sm:text-sm mt-1 sm:mt-2">SECRETARIA DE SEGURANÇA PÚBLICA</p>
                <p className="text-center font-bold text-[0.8rem] sm:text-xl">CARTEIRA DE IDENTIDADE</p>
                <main className="flex-grow flex gap-2 sm:gap-3 mt-1 sm:mt-3">
                    <div className="w-1/4 flex flex-col items-center justify-between">
                        <img src={user.avatar_url} alt="Foto" className="w-full aspect-[3/4] object-cover border-2 border-gray-400"/>
                        <div className="w-full aspect-square mt-1 border border-black p-0.5">
                           <FingerprintSVG seed={user.id} />
                        </div>
                        <p className="text-[0.4rem] sm:text-[9px] mt-1 text-center">POLEGAR DIREITO</p>
                    </div>
                    <div className="w-3/4 space-y-1 sm:space-y-1.5 text-[0.5rem] sm:text-[11px] p-1">
                        <DocumentField label="REGISTRO GERAL" value={formatRG(doc.document_number)} className="text-red-600 font-mono" />
                        <DocumentField label="DATA DE EXPEDIÇÃO" value={new Date(doc.issued_at).toLocaleDateString('pt-BR')} />
                        <DocumentField label="NOME" value={user.full_name?.toUpperCase()} />
                        <DocumentField label="FILIAÇÃO" value="NÃO INFORMADO" />
                        <DocumentField label="NATURALIDADE" value="GOV - RP" />
                        <DocumentField label="DATA NASC." value={dateOfBirth} />
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
)};

const CPFDocument = ({ user, doc, side }) => {
    const dateOfBirth = new Date(user.date_of_birth.replace(/-/g, '\/')).toLocaleDateString('pt-BR');
    return (
    <DocumentContainer className="bg-gradient-to-br from-blue-50 to-green-50 text-black font-sans justify-between">
        {side === 'front' ? (
            <>
                <header className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <img src={SEAL_IMAGE} alt="Selo" className="w-8 h-8 sm:w-12 sm:h-12 object-contain"/>
                        <div className="text-center">
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
                    <p className="font-semibold text-base sm:text-xl">{dateOfBirth}</p>
                </main>
                <footer className="text-right text-[0.5rem] sm:text-xs">
                    <p>EMISSÃO: {new Date(doc.issued_at).toLocaleDateString('pt-BR')}</p>
                </footer>
            </>
        ) : (
            <GenericBackSide doc={doc} />
        )}
    </DocumentContainer>
)};

const CNPJDocument = ({ user, doc, side }) => (
    <DocumentContainer className="bg-white text-black font-sans justify-between">
        {side === 'front' ? (
            <>
                <header className="text-center border-b-2 border-black pb-1 sm:pb-2">
                    <img src={SEAL_IMAGE} alt="Selo" className="mx-auto mb-2 h-10 w-10 object-contain sm:h-12 sm:w-12" />
                    <p className="text-[0.5rem] sm:text-sm font-bold">REPÚBLICA FEDERATIVA DE GOV.RP</p>
                    <p className="text-base sm:text-xl font-bold">CADASTRO NACIONAL DA PESSOA JURÍDICA</p>
                </header>
                <main className="space-y-1 sm:space-y-1.5 text-[0.6rem] sm:text-sm">
                    <DocumentField label="NÚMERO DE INSCRIÇÃO" value={doc.document_number} />
                    <DocumentField label="DATA DE ABERTURA" value={new Date(doc.issued_at).toLocaleDateString('pt-BR')} />
                    <DocumentField label="NOME EMPRESARIAL" value={doc.metadata?.company_name?.toUpperCase() || 'N/A'} />
                    <DocumentField label="TÍTULO DO ESTABELECIMENTO (NOME DE FANTASIA)" value={doc.metadata?.company_name?.toUpperCase() || 'N/A'} />
                    <DocumentField label="CÓDIGO E DESCRIÇÃO DA ATIVIDADE ECONÔMICA PRINCIPAL" value="96.09-2-99 - OUTRAS ATIVIDADES DE SERVIÇOS PESSOAIS" />
                    <DocumentField label="ENDEREÇO" value="GOV, RP" />
                    <DocumentField label="SITUAÇÃO CADASTRAL" value="ATIVA" />
                </main>
                <footer className="text-center text-[0.4rem] sm:text-[10px]">
                    <p>Aprovado pela Instrução Normativa RFB nº 1.863, de 27 de dezembro de 2018.</p>
                </footer>
            </>
        ) : (
            <GenericBackSide doc={doc} />
        )}
    </DocumentContainer>
);

const CTDDocument = ({ user, doc, side }) => {
    const dateOfBirth = new Date(user.date_of_birth.replace(/-/g, '\/')).toLocaleDateString('pt-BR');
    return (
    <DocumentContainer className="bg-[#0A2240] text-white font-sans">
        {side === 'front' ? (
            <div className="w-full h-full flex flex-col justify-between">
                <header className="flex items-center justify-between">
                    <img src={SEAL_IMAGE} alt="Brasão" className="w-10 h-10 sm:w-14 sm:h-14 object-contain" />
                    <div className="text-right">
                        <p className="font-bold text-base sm:text-xl">CARTEIRA DE TRABALHO</p>
                        <p className="text-[0.6rem] sm:text-sm">E PREVIDÊNCIA SOCIAL</p>
                    </div>
                </header>
                <main className="flex items-center gap-2 sm:gap-4">
                    <img src={user.avatar_url} alt="Foto" className="w-1/4 aspect-[3/4] object-cover border-2 border-white"/>
                    <div className="text-[0.6rem] sm:text-sm flex-1 space-y-1">
                        <DocumentField label="NOME" value={user.full_name?.toUpperCase()} className="text-white" />
                        <DocumentField label="NASCIMENTO" value={dateOfBirth} className="text-white" />
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
)};

const TituloEleitorDocument = ({ user, doc, side }) => {
    const dateOfBirth = new Date(user.date_of_birth.replace(/-/g, '\/')).toLocaleDateString('pt-BR');
    return (
    <DocumentContainer className="bg-white text-black font-mono">
        {side === 'front' ? (
            <>
                <header className="flex items-center justify-between border-b-2 border-black pb-1 sm:pb-2">
                    <div className="flex items-center gap-2 sm:gap-3">
                        <img src={SEAL_IMAGE} alt="Selo" className="w-8 h-8 sm:w-12 sm:h-12 object-contain"/>
                        <p className="font-bold text-base sm:text-lg">JUSTIÇA ELEITORAL</p>
                    </div>
                    <Vote className="w-8 h-8 sm:w-10 sm:h-10" />
                </header>
                <main className="flex-grow flex items-center justify-between mt-2 sm:mt-3">
                    <div className="w-2/3 space-y-2 sm:space-y-2.5 text-[0.6rem] sm:text-sm">
                        <DocumentField label="NÚMERO DE INSCRIÇÃO" value={doc.document_number} />
                        <DocumentField label="NOME" value={user.full_name?.toUpperCase()} />
                        <div className="flex gap-4 sm:gap-6">
                            <DocumentField label="DATA NASC." value={dateOfBirth} />
                            <DocumentField label="ZONA" value="001" />
                            <DocumentField label="SEÇÃO" value="0001" />
                        </div>
                        <DocumentField label="MUNICÍPIO" value="GOV - RP" />
                        <DocumentField label="DATA DE EMISSÃO" value={new Date(doc.issued_at).toLocaleDateString('pt-BR')} />
                    </div>
                    <div className="w-1/3 flex flex-col items-center">
                        <QRCode value={doc.qr_code_data || 'gov.rp'} size={64} renderAs="svg" />
                        <p className="text-[0.4rem] sm:text-[10px] mt-2 text-center">Este documento é válido e substitui o título de eleitor físico.</p>
                    </div>
                </main>
            </>
        ) : (
            <GenericBackSide doc={doc} />
        )}
    </DocumentContainer>
)};

const CNHDocument = ({ user, doc, side }) => {
    const dateOfBirth = new Date(user.date_of_birth.replace(/-/g, '\/')).toLocaleDateString('pt-BR');
    return (
    <DocumentContainer className="bg-gradient-to-br from-green-100 to-blue-100 text-black font-mono">
        {side === 'front' ? (
            <>
                <header className="flex items-center justify-between pb-1">
                    <div className="flex items-center gap-2">
                         <img src={SEAL_IMAGE} alt="Selo" className="w-8 h-8 sm:w-10 sm:h-10 object-contain"/>
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
                            <DocumentField label="DATA NASC." value={dateOfBirth} />
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
                    <QRCode value={doc.qr_code_data || 'gov.rp'} size={32} renderAs="svg" bgColor="transparent" fgColor="#000000" level="L" />
                </footer>
            </>
        ) : (
             <div className="w-full h-full flex flex-col justify-between">
                 <div className="flex justify-between items-start">
                    <p className="text-[0.5rem] sm:text-xs text-gray-600">OBSERVAÇÕES</p>
                    <p className="text-right text-[0.5rem] sm:text-xs text-gray-600">LOCAL DE EMISSÃO<br/><span className="font-bold text-black">GOV - RP</span></p>
                 </div>
                 <div className="text-center">
                    <p className="text-[0.6rem] sm:text-sm font-bold">ASSINATURA DO EMISSOR</p>
                    <p className="font-serif text-lg sm:text-xl -mt-1">Assinatura Digital</p>
                 </div>
                 <div className="h-3 sm:h-5 bg-gray-300 w-full"></div>
             </div>
        )}
    </DocumentContainer>
)};

const PassportDocument = ({ user, doc, side }) => {
    const dateOfBirth = new Date(user.date_of_birth.replace(/-/g, '\/')).toLocaleDateString('pt-BR');
    const { surname, givenNames } = getPassportNames(user.full_name);
    const mrzLineOne = buildMrzLine(`P<GOV${surname}<<${givenNames}`);
    const mrzLineTwo = buildMrzLine(
        `${normalizeMrzValue(doc.document_number)}<0GOV${formatPassportMrzDate(user.date_of_birth)}X${formatPassportMrzDate(doc.expires_at)}`
    );

    return (
     <DocumentContainer className={`font-serif ${side === 'front' ? 'bg-[#0A2240] text-white' : 'bg-gray-100 text-black'}`}>
        {side === 'front' ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-center">
                <img src={SEAL_IMAGE} alt="Brasão" className="w-12 h-12 sm:w-20 sm:h-20 mb-2 sm:mb-3 object-contain" />
                <p className="text-[0.6rem] sm:text-lg tracking-[0.2em]">REPÚBLICA FEDERATIVA DE GOV.RP</p>
                <div className="w-2/3 h-px bg-white/50 my-2 sm:my-4"></div>
                <p className="text-xl sm:text-3xl font-bold tracking-wider">PASSAPORTE</p>
            </div>
        ) : (
            <div className="flex h-full flex-col gap-3 rounded-md bg-white/80 p-3 sm:gap-4 sm:p-4">
                 <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-2">
                    <div>
                        <p className="text-[0.6rem] sm:text-[0.78rem] text-slate-500 tracking-[0.28em]">PASSAPORTE</p>
                        <p className="text-[0.46rem] sm:text-[0.6rem] uppercase tracking-[0.22em] text-slate-400">República Federativa de GOV.RP</p>
                    </div>
                    <div className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[0.48rem] font-semibold uppercase tracking-[0.22em] text-slate-500 sm:text-[0.58rem]">
                        Documento Oficial
                    </div>
                 </div>

                 <div className="grid flex-1 grid-cols-[96px_1fr] gap-3 sm:grid-cols-[112px_1fr] sm:gap-4">
                    <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                        <img src={user.avatar_url} alt="Foto" className="h-full w-full object-cover"/>
                    </div>

                    <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:gap-x-4 sm:gap-y-2.5">
                        <PassportField label="Tipo/Type" value="P" />
                        <PassportField label="País/Country" value="GOV" />
                        <PassportField label="Passaporte Nº" value={doc.document_number} className="col-span-2" />
                        <PassportField label="Apelido/Surname" value={surname} className="col-span-2" />
                        <PassportField label="Nomes/Given Names" value={givenNames} className="col-span-2" />
                        <PassportField label="Nacionalidade" value="GOVERNIANA" />
                        <PassportField label="Data de Nasc." value={dateOfBirth} />
                        <PassportField label="Data de Emissão" value={new Date(doc.issued_at).toLocaleDateString('pt-BR')} />
                        <PassportField label="Data de Validade" value={doc.expires_at ? new Date(doc.expires_at).toLocaleDateString('pt-BR') : 'INDEFINIDA'} />
                    </div>
                 </div>

                 <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2 font-mono text-[0.43rem] leading-none tracking-[0.16em] text-slate-900 sm:px-3 sm:text-[0.56rem]">
                    <p className="overflow-hidden whitespace-nowrap">{mrzLineOne}</p>
                    <p className="mt-1 overflow-hidden whitespace-nowrap">{mrzLineTwo}</p>
                 </div>
            </div>
        )}
    </DocumentContainer>
)};

const MarriageCertificateDocument = ({ user, doc }) => {
    const dateOfBirth = new Date(user.date_of_birth.replace(/-/g, '\/')).toLocaleDateString('pt-BR');
    return (
        <div className="p-6 bg-white rounded-lg text-black font-serif max-w-2xl mx-auto border-4 border-pink-300">
            <header className="text-center mb-6">
                <img src={SEAL_IMAGE} alt="Brasão da República" className="w-20 h-20 mx-auto mb-2 object-contain" />
                <h1 className="text-sm font-bold">REPÚBLICA FEDERATIVA DE GOV.RP</h1>
                <h2 className="text-xs">CARTÓRIO DE REGISTRO CIVIL</h2>
            </header>
            <h3 className="text-lg font-bold text-center mb-6">CERTIDÃO DE CASAMENTO</h3>
            <main className="text-sm space-y-3 text-justify leading-relaxed">
                <p>Certifico que, no livro de registros de casamentos nº 001, folha 01, sob o nº <strong>{doc.document_number}</strong>, foi registrado o casamento de:</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-4 p-4 border-y border-gray-300">
                    <div>
                        <p className="font-semibold text-gray-600">CÔNJUGE 1:</p>
                        <p className="font-bold">{user.full_name?.toUpperCase()}</p>
                        <p>Nascido(a) em: {dateOfBirth}</p>
                    </div>
                    <div>
                        <p className="font-semibold text-gray-600">CÔNJUGE 2:</p>
                        <p className="font-bold">{doc.metadata?.spouse_name?.toUpperCase() || 'NÃO INFORMADO'}</p>
                    </div>
                </div>
                <p>Celebrado em <strong>{new Date(doc.issued_at).toLocaleDateString('pt-BR')}</strong>, sob o regime de <strong>COMUNHÃO PARCIAL DE BENS</strong>.</p>
            </main>
            <footer className="mt-8 text-center text-xs">
                <p>GOV - RP, {new Date(doc.issued_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}.</p>
            </footer>
        </div>
    );
};

const ProfessionalRegistryDocument = ({ user, doc, side }) => (
    <DocumentContainer className="bg-gradient-to-br from-cyan-50 to-indigo-50 text-black font-sans">
        {side === 'front' ? (
            <>
                <header className="flex items-center justify-between pb-1 sm:pb-2 border-b-2 border-black">
                    <h1 className="font-bold text-[0.6rem] sm:text-base">CONSELHO PROFISSIONAL DE GOV.RP</h1>
                    <img src={SEAL_IMAGE} alt="Selo" className="h-9 w-9 object-contain sm:h-12 sm:w-12" />
                </header>
                <p className="mt-2 text-center font-bold text-[0.76rem] sm:text-lg">CARTEIRA DE IDENTIDADE PROFISSIONAL</p>
                <main className="mt-2 flex flex-grow gap-2 sm:mt-3 sm:gap-3">
                    <img src={user.avatar_url} alt="Foto" className="w-1/3 aspect-[3/4] object-cover border-2 border-gray-400"/>
                    <div className="w-2/3 space-y-1 sm:space-y-1.5 text-[0.5rem] sm:text-[11px] p-1">
                        <DocumentField label="NOME COMPLETO" value={user.full_name?.toUpperCase()} />
                        <DocumentField label="PROFISSÃO" value={doc.metadata?.profession?.toUpperCase() || 'NÃO ESPECIFICADO'} />
                        <DocumentField label="Nº DE REGISTRO" value={doc.document_number} className="text-red-600 font-mono" />
                        <DocumentField label="CPF" value={formatCPF(user.cpf)} />
                        <DocumentField label="DATA DE EMISSÃO" value={new Date(doc.issued_at).toLocaleDateString('pt-BR')} />
                    </div>
                </main>
                <footer className="mt-1 text-center text-[10px] sm:text-xs">
                    <p className="font-serif text-sm sm:text-base">Assinatura do Portador</p>
                </footer>
            </>
        ) : (
            <GenericBackSide doc={doc} />
        )}
    </DocumentContainer>
);

const ReservistCertificateDocument = ({ user, doc, side }) => {
    const dateOfBirth = new Date(user.date_of_birth.replace(/-/g, '\/')).toLocaleDateString('pt-BR');
    return (
    <DocumentContainer className="bg-gradient-to-br from-green-100 to-yellow-100 text-black font-mono">
        {side === 'front' ? (
            <>
                <header className="text-center mb-1">
                    <img src={SEAL_IMAGE} alt="Brasão da República" className="w-12 h-12 mx-auto mb-1 object-contain" />
                    <h1 className="text-[0.72rem] font-bold sm:text-sm">REPÚBLICA FEDERATIVA DE GOV.RP</h1>
                    <h2 className="text-[0.62rem] sm:text-xs">MINISTÉRIO DA DEFESA - FORÇAS ARMADAS</h2>
                </header>
                <h3 className="mb-2 text-center text-base font-bold sm:text-lg">CERTIFICADO DE RESERVISTA</h3>
                <main className="space-y-1.5 text-xs sm:text-sm">
                    <DocumentField label="NOME" value={user.full_name?.toUpperCase()} />
                    <DocumentField label="NASCIMENTO" value={dateOfBirth} />
                    <DocumentField label="Nº DE REGISTRO" value={doc.document_number} />
                    <p className="leading-snug">Certificamos que o cidadão acima qualificado foi dispensado do serviço militar inicial por ter sido incluído no excesso de contingente.</p>
                </main>
                <footer className="mt-3 text-center text-[10px] sm:text-xs">
                    <p>Emitido em: {new Date(doc.issued_at).toLocaleDateString('pt-BR')}</p>
                </footer>
            </>
        ) : (
            <GenericBackSide doc={doc} />
        )}
    </DocumentContainer>
)};


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
      'Certidão de Casamento': MarriageCertificateDocument,
      'Registro Profissional': ProfessionalRegistryDocument,
      'Certificado de Reservista': ReservistCertificateDocument,
  }[doc.type];

  const hasTwoSides = !['Certidão de Casamento'].includes(doc.type);

  if (!DocumentComponent) return null;

  const isFullPageDoc = ['Certidão de Casamento'].includes(doc.type);
  const actionButtonClassName =
    doc.type === 'Passport' && side === 'back'
      ? 'text-slate-700 bg-white/90 border border-slate-200 hover:bg-white h-8 w-8'
      : 'text-white bg-black/50 hover:bg-black/70 h-8 w-8';

  if (isFullPageDoc) {
    return (
        <div className="relative w-full max-w-2xl mx-auto bg-background rounded-lg shadow-lg">
            <div className="p-4 overflow-y-auto max-h-[80vh]">
                <DocumentComponent user={user} doc={doc} />
            </div>
            {onBack && (
                <Button variant="ghost" size="icon" onClick={onBack} className="absolute top-2 right-2 text-foreground bg-background/50 hover:bg-background/70 h-8 w-8"><X className="h-4 w-4"/></Button>
            )}
        </div>
    );
  }

  return (
    <div className={`relative mx-auto w-full ${onBack ? 'max-w-[30rem] pr-12' : 'max-w-md'}`}>
      <DocumentComponent user={user} doc={doc} side={side}/>
       {onBack && (
        <div className="absolute right-2 top-2 flex flex-col gap-2">
           <Button variant="ghost" size="icon" onClick={onBack} className={actionButtonClassName}><X className="h-4 w-4"/></Button>
           {hasTwoSides && <Button variant="ghost" size="icon" onClick={() => setSide(s => s === 'front' ? 'back' : 'front')} className={actionButtonClassName}><RefreshCw className="h-4 w-4"/></Button>}
        </div>
       )}
    </div>
  )
};
