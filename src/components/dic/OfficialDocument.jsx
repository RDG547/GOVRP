import { formatLocaleBR } from '@/lib/dateTime';
import CitizenSignature from './CitizenSignature';
import { documentCatalog as docInfo, documentHasTwoSides, documentIsFullPage } from '@/lib/documentCatalog';
import { fingerprintPaths } from '@/lib/citizenFingerprint';
import React, { useState, useMemo, useLayoutEffect, useRef } from 'react';
import QRCode from 'qrcode.react';
import { formatCPF, formatRG } from '@/lib/utils';
import { Fingerprint, FileText, Car, Globe, Building, Briefcase, Vote, ShieldCheck, Heart, Award, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

// O selo oficial precisa funcionar offline no PWA e nas versões nativas.
// Ele reutiliza a mesma identidade visual do favicon/ícone do aplicativo.
const SEAL_IMAGE = '/icon-512x512.png';

const formatValue = (type, value) => {
    if (type === 'CPF') return formatCPF(value);
    if (type === 'RG') return formatRG(value);
    return value;
};

const formatDocumentDate = (value) => {
    if (!value) return 'NÃO INFORMADA';
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? 'NÃO INFORMADA' : formatLocaleBR(date, 'toLocaleDateString', 'pt-BR');
};

const getCitizenNaturality = (user) => {
    const city = user?.birth_city_name;
    const state = user?.birth_state_code;
    if (city && state) return `${city} - ${state}`;
    return city || state || 'NÃO INFORMADA';
};

const getCitizenResidence = (user) => {
    const city = user?.residence_city_name;
    const state = user?.residence_state_code;
    if (city && state) return `${city} - ${state}`;
    return city || state || 'NÃO INFORMADO';
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

const buildMrzDocumentNumber = (value = '') =>
    normalizeMrzValue(value)
        .replace(/\s+/g, '')
        .padEnd(9, '<')
        .slice(0, 9);

const getPassportNames = (fullName = '') => {
    const normalized = normalizeMrzValue(fullName);
    if (!normalized) {
        return {
            surname: 'GOVRP',
            givenNames: '',
        };
    }

    const parts = normalized.split(' ').filter(Boolean);
    if (parts.length === 1) {
        return {
            surname: parts[0],
            givenNames: '',
        };
    }

    return {
        surname: parts.slice(-1).join(' '),
        givenNames: parts.slice(0, -1).join(' '),
    };
};

const PassportField = ({ label, value, className = '' }) => (
    <div className={className}>
        <p className="block py-px font-semibold text-slate-500 uppercase tracking-[0.14em] text-[0.42rem] sm:text-[0.48rem] leading-[1.3]">
            {label}
        </p>
        <p className="py-px font-bold text-slate-950 text-[0.56rem] sm:text-[0.66rem] leading-[1.35] break-words">
            {value || 'N/A'}
        </p>
    </div>
);

const hasTextColorClass = (className = '') =>
    /\btext-(black|white|gray|slate|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-/.test(className) ||
    className.includes('text-white') ||
    className.includes('text-black');

const DocumentField = ({ label, value, className = '' }) => {
    const inheritTextColor = hasTextColorClass(className);

    return (
        <div className={className}>
            <p className={`block py-px font-semibold uppercase tracking-wider text-[7px] leading-[1.3] ${inheritTextColor ? 'opacity-70' : 'text-gray-500'}`}>{label}</p>
            <p className={`py-px font-bold text-[10px] leading-[1.3] break-words ${inheritTextColor ? '' : 'text-black'}`}>{value || 'N/A'}</p>
        </div>
    );
};

// The physical card keeps one layout. Mobile scales the entire card instead of
// independently shrinking rows, photos and the reserved signature region.
const DocumentContainer = ({ children, className = '', identity }) => {
    const ref = useRef(null);
    const [scale, setScale] = useState(1);
    useLayoutEffect(() => {
        const resize = () => setScale((ref.current?.clientWidth || 470) / 470);
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, []);
    return <div ref={ref} data-official-document data-document-identity={identity} className="relative box-border aspect-[47/33] w-full max-w-[470px] shrink-0 overflow-hidden rounded-lg shadow-lg">
        <div data-document-layout className={`absolute left-0 top-0 h-[330px] w-[470px] origin-top-left overflow-hidden rounded-lg border ${className}`} style={{ transform: `scale(${scale})` }}>
            <div className="absolute inset-3 flex min-h-0 flex-col">{children}</div>
        </div>
    </div>;
};

const FingerprintSVG = ({ seed }) => {
    const paths = useMemo(() => fingerprintPaths(seed), [seed]);

    return (
        <svg viewBox="0 0 100 110" className="w-full h-full" role="img" aria-label="Digital fictícia do cidadão"><defs><clipPath id={`print-${String(seed).replace(/[^a-zA-Z0-9]/g, '')}`}><ellipse cx="50" cy="53" rx="42" ry="51" /></clipPath></defs><g clipPath={`url(#print-${String(seed).replace(/[^a-zA-Z0-9]/g, '')})`}>
            {paths.map((d, i) => (
                <path key={i} d={d} stroke="black" strokeWidth="1.05" fill="none" strokeLinecap="round" />
            ))}</g>
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
    const dateOfBirth = formatDocumentDate(user.date_of_birth);
    return (
    <DocumentContainer className="bg-gradient-to-br from-gray-100 to-blue-50 text-black font-sans">
        {side === 'front' ? (
            <>
                <header className="flex shrink-0 items-center justify-between border-b-2 border-black pb-1">
                    <h1 className="font-bold text-[0.6rem] sm:text-sm">REPÚBLICA FEDERATIVA DE GOV.RP</h1>
                    <img src={SEAL_IMAGE} alt="Selo" className="h-8 w-8 object-contain sm:h-10 sm:w-10"/>
                </header>
                <p className="mt-1 shrink-0 text-center font-semibold text-[0.5rem] sm:text-[0.68rem]">DEPARTAMENTO DE IDENTIFICAÇÃO CIVIL — DIC</p>
                <p className="shrink-0 text-center font-bold text-[0.8rem] sm:text-base">CARTEIRA DE IDENTIDADE</p>
                <main className="mt-1 flex min-h-0 flex-grow gap-2 sm:gap-3">
                    <div className="flex w-1/4 min-h-0 flex-col items-center">
                        <img src={user.avatar_url} alt="Foto" className="h-[52%] min-h-0 w-full object-cover border-2 border-gray-400"/>
                        <div className="mt-1 h-[31%] min-h-0 w-full border border-black p-0.5">
                           <FingerprintSVG seed={user.citizen_id || doc.citizen_id || user.id} />
                        </div>
                        <p className="mt-1 shrink-0 text-center text-[0.4rem] sm:text-[8px]">POLEGAR DIREITO</p>
                    </div>
                    <div className="grid min-h-0 w-3/4 grid-cols-2 content-start gap-x-2 gap-y-0.5 p-0.5 text-[0.5rem] sm:text-[11px]">
                        <DocumentField label="REGISTRO GERAL" value={formatRG(doc.document_number)} className="text-red-600 font-mono" />
                        <DocumentField label="DATA DE EXPEDIÇÃO" value={formatDocumentDate(doc.issued_at)} />
                        <DocumentField label="NOME" value={user.full_name?.toUpperCase()} className="col-span-2" />
                        <DocumentField label="FILIAÇÃO" value="NÃO INFORMADO" className="col-span-2" />
                        <DocumentField label="NATURALIDADE" value={getCitizenNaturality(user).toUpperCase()} />
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
                <CitizenSignature user={user} className="mx-auto mt-2" />
            </div>
        )}
    </DocumentContainer>
)};

const CPFDocument = ({ user, doc, side }) => {
    const dateOfBirth = formatDocumentDate(user.date_of_birth);
    return (
    <DocumentContainer identity="cpf" className="bg-gradient-to-br from-blue-50 to-green-50 text-black font-sans justify-between">
        {side === 'front' ? (
            <>
                <header className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <img src={SEAL_IMAGE} alt="Selo" className="w-8 h-8 sm:w-12 sm:h-12 object-contain"/>
                        <div className="text-center">
                            <p className="text-[0.5rem] sm:text-sm font-bold">REPÚBLICA FEDERATIVA DE GOV.RP</p>
                            <p className="text-[0.4rem] sm:text-xs">DEPARTAMENTO DE IDENTIFICAÇÃO CIVIL — DIC</p>
                            <p className="text-[0.4rem] sm:text-xs">SECRETARIA DA RECEITA FEDERAL</p>
                        </div>
                    </div>
                    <p className="font-bold text-lg sm:text-xl">CPF</p>
                </header>
                <main className="text-center">
                    <p className="text-[0.6rem] sm:text-sm">NÚMERO DE INSCRIÇÃO</p>
                    <p className="font-mono font-bold text-2xl sm:text-4xl tracking-wider">{formatCPF(doc.document_number)}</p>
                    <p className="text-[0.6rem] sm:text-sm mt-1 sm:mt-2">NOME</p>
                    <p className="break-words text-base font-semibold leading-tight sm:text-xl">{user.full_name?.toUpperCase()}</p>
                    <p className="text-[0.6rem] sm:text-sm mt-1 sm:mt-2">DATA DE NASCIMENTO</p>
                    <p className="font-semibold text-base sm:text-xl">{dateOfBirth}</p>
                </main>
                <footer className="text-right text-[0.5rem] sm:text-xs">
                    <p>EMISSÃO: {formatDocumentDate(doc.issued_at)}</p>
                </footer>
            </>
        ) : (
            <GenericBackSide doc={doc} />
        )}
    </DocumentContainer>
)};

const CNPJDocument = ({ user, doc, side }) => (
    <DocumentContainer identity="cnpj" className="bg-white text-black font-sans justify-between">
        {side === 'front' ? (
            <>
                <header className="text-center border-b-2 border-black pb-1 sm:pb-2">
                    <img src={SEAL_IMAGE} alt="Selo" className="mx-auto mb-1 h-8 w-8 object-contain sm:h-10 sm:w-10" />
                    <p className="text-[0.5rem] sm:text-sm font-bold">REPÚBLICA FEDERATIVA DE GOV.RP</p>
                    <p className="text-xs sm:text-base font-bold">CADASTRO NACIONAL DA PESSOA JURÍDICA</p>
                </header>
                <main className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[0.6rem] sm:text-sm">
                    <DocumentField label="NÚMERO DE INSCRIÇÃO" value={doc.document_number} />
                    <DocumentField label="DATA DE ABERTURA" value={formatDocumentDate(doc.issued_at)} />
                    <DocumentField className="col-span-2" label="NOME EMPRESARIAL" value={doc.metadata?.company_name?.toUpperCase() || 'N/A'} />
                    <DocumentField className="col-span-2" label="TÍTULO DO ESTABELECIMENTO (NOME DE FANTASIA)" value={doc.metadata?.company_name?.toUpperCase() || 'N/A'} />
                    <DocumentField className="col-span-2" label="CÓDIGO E DESCRIÇÃO DA ATIVIDADE ECONÔMICA PRINCIPAL" value={doc.metadata?.activity_name?.toUpperCase() || doc.metadata?.business_type_id || 'ATIVIDADE HISTÓRICA NÃO INFORMADA'} />
                    <DocumentField label="ENDEREÇO" value="GOV, RP" />
                    <DocumentField label="SITUAÇÃO CADASTRAL" value={doc.is_valid ? 'ATIVA' : 'ENCERRADA'} />
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
    const contracts=doc.metadata?.employment_contracts||[];const contract=contracts.find(row=>!row.fired_at)||contracts[0];const appointments=doc.metadata?.institutional_appointments||[];const institutional=appointments.find(row=>row.active)||(!contract?appointments[0]:null);
    const dateOfBirth = formatDocumentDate(user.date_of_birth);
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
                    <div className="w-1/4 shrink-0 self-start aspect-[3/4] overflow-hidden border-2 border-white bg-white/10"><img src={user.avatar_url} alt="Foto do cidadão" className="h-full w-full object-cover object-center" /></div>
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
                    <CitizenSignature user={user} />
                </footer>
            </div>
        ) : (
            <div className="w-full h-full flex flex-col justify-between text-[0.6rem] sm:text-sm">
                <p className="font-bold text-center text-lg">{institutional?'VÍNCULO INSTITUCIONAL':'CONTRATO DE TRABALHO'}</p>
                <div className="grid grid-cols-2 gap-2 border-y border-white/50 py-2">
                    <DocumentField label={institutional?'INSTITUIÇÃO':'EMPREGADOR'} value={institutional?.institution||contract?.company||'SEM VÍNCULO REGISTRADO'} className="col-span-2 text-white"/>
                    <DocumentField label="FUNÇÃO" value={institutional?.role||contract?.role||'SEM CONTRATO ATIVO'} className="col-span-2 text-white"/>
                    <DocumentField label="TIPO" value={institutional?.type||(contract?'Vínculo empresarial':'Não registrado')} className="text-white"/>
                    <DocumentField label="SITUAÇÃO" value={institutional?(institutional.active?'Ativo':'Encerrado'):contract?(contract.fired_at?'Encerrado':'Ativo'):'Sem vínculo'} className="text-white"/>
                    <DocumentField label={institutional?'INÍCIO':'DATA DE ADMISSÃO'} value={formatDocumentDate(institutional?.started_at||contract?.hired_at)} className="text-white"/>
                    {contract&&!institutional&&contract.salary!=null&&<DocumentField label="REMUNERAÇÃO CONTRATUAL" value={Number(contract.salary).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} className="text-white"/>}
                </div>
                <div className="max-h-12 overflow-y-auto text-[9px]" aria-label="Histórico de vínculos">{appointments.filter(row=>row.id!==institutional?.id).map(row=><p key={row.id}>{row.role} · {row.type} · {row.active?'Ativo':`Encerrado ${formatDocumentDate(row.ended_at)}`}</p>)}{contracts.filter(row=>row.id!==contract?.id||institutional).map(row=><p key={row.id}>{row.company} · {row.role} · {row.fired_at?formatDocumentDate(row.fired_at):'Ativo'}</p>)}{contract?.history?.map((entry,index)=><p key={index}>{entry.role} · até {formatDocumentDate(entry.until)}</p>)}</div><p className="text-[0.5rem] sm:text-xs text-center">Registros profissionais e institucionais do GOVRP.</p>
            </div>
        )}
    </DocumentContainer>
)};

const TituloEleitorDocument = ({ user, doc, side }) => {
    const dateOfBirth = formatDocumentDate(user.date_of_birth);
    return (
    <DocumentContainer identity="voter" className="bg-white text-black font-mono">
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
                            <DocumentField label="ZONA" value={doc.metadata?.electoral_zone || "EM REGULARIZAÇÃO"} />
                            <DocumentField label="SEÇÃO" value={doc.metadata?.electoral_section || "EM REGULARIZAÇÃO"} />
                        </div>
                        <DocumentField label="MUNICÍPIO / UF" value={getCitizenResidence(user).toUpperCase()} />
                        <DocumentField label="DATA DE EMISSÃO" value={formatDocumentDate(doc.issued_at)} />
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
    const dateOfBirth = formatDocumentDate(user.date_of_birth);
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
                <div className="flex min-h-0 flex-1 gap-3 mt-2">
                    <div className="w-1/4 flex flex-col items-center justify-start">
                        <img src={user.avatar_url} alt="Foto" className="w-full aspect-[3/4] object-cover border-2 border-gray-400"/>
                    </div>
                    <div className="w-3/4 space-y-1 sm:space-y-1.5 text-[0.5rem] sm:text-[11px] bg-white/30 p-1 sm:p-2 rounded">
                        <DocumentField label="NOME" value={user.full_name?.toUpperCase()} />
                        <div className="flex justify-between gap-2">
                            <DocumentField label="DOC. IDENTIDADE / ORG. EMISSOR" value={`${formatRG(user.rg)} DIC/RP`} />
                            <DocumentField label="CPF" value={formatCPF(user.cpf)} />
                        </div>
                        <div className="flex justify-between">
                            <DocumentField label="DATA NASC." value={dateOfBirth} />
                            <DocumentField label="CATEGORIA" value="AB" />
                        </div>
                        <DocumentField label="N° REGISTRO" value={doc.document_number} />
                        <div className="flex justify-between">
                            <DocumentField label="VALIDADE" value={doc.expires_at ? formatDocumentDate(doc.expires_at) : 'INDEFINIDA'} />
                            <DocumentField label="1ª HABILITAÇÃO" value={formatDocumentDate(doc.issued_at)} />
                        </div>
                    </div>
                </div>
                <footer className="flex shrink-0 items-end justify-between gap-3 pt-2">
                    <CitizenSignature user={user} />
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
    const dateOfBirth = formatDocumentDate(user.date_of_birth);
    const { surname, givenNames } = getPassportNames(user.full_name);
    const mrzLineOne = buildMrzLine(`P<GOV${surname}${givenNames ? `<<${givenNames}` : '<<'}`);
    const mrzLineTwo = buildMrzLine(
        `${buildMrzDocumentNumber(doc.document_number)}<GOV${formatPassportMrzDate(user.date_of_birth)}X${formatPassportMrzDate(doc.expires_at)}<<<<<<<<<<<<<<`
    );

    return (
     <DocumentContainer identity="passport" className={`font-serif ${side === 'front' ? 'bg-[#0A2240] text-white' : 'bg-gray-100 text-black'}`}>
        {side === 'front' ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-center">
                <img src={SEAL_IMAGE} alt="Brasão" className="w-12 h-12 sm:w-20 sm:h-20 mb-2 sm:mb-3 object-contain" />
                <p className="text-[0.6rem] sm:text-lg tracking-[0.2em]">REPÚBLICA FEDERATIVA DE GOV.RP</p>
                <div className="w-2/3 h-px bg-white/50 my-2 sm:my-4"></div>
                <p className="text-xl sm:text-3xl font-bold tracking-wider">PASSAPORTE</p>
            </div>
        ) : (
            <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden rounded-md bg-white/80 p-2 sm:p-3">
                 <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 pb-1.5">
                    <div>
                        <p className="text-[0.56rem] sm:text-[0.72rem] text-slate-500 tracking-[0.24em]">PASSAPORTE</p>
                        <p className="text-[0.44rem] sm:text-[0.54rem] uppercase tracking-[0.18em] text-slate-400">República Federativa de GOV.RP</p>
                    </div>
                    <div className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[0.44rem] font-semibold uppercase tracking-[0.18em] text-slate-500 sm:text-[0.52rem]">
                        Documento Oficial
                    </div>
                 </div>

                 <div className="grid min-h-0 flex-1 grid-cols-[90px_1fr] gap-2.5 overflow-hidden sm:grid-cols-[108px_1fr] sm:gap-3">
                    <div className="min-h-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                        <img src={user.avatar_url} alt="Foto" className="h-full w-full object-cover"/>
                    </div>

                    <div className="grid min-h-0 grid-cols-2 content-start gap-x-2.5 gap-y-1 sm:gap-x-3 sm:gap-y-1.5">
                        <PassportField label="Tipo/Type" value="P" />
                        <PassportField label="País/Country" value="GOV" />
                        <PassportField label="Passaporte Nº" value={doc.document_number} className="col-span-2" />
                        <PassportField label="Apelido/Surname" value={surname} className="col-span-2" />
                        <PassportField label="Nomes/Given Names" value={givenNames} className="col-span-2" />
                        <PassportField label="Nacionalidade" value="GOVERNIANA" />
                        <PassportField label="Data de Nasc." value={dateOfBirth} />
                        <PassportField label="Data de Emissão" value={formatDocumentDate(doc.issued_at)} />
                        <PassportField label="Data de Validade" value={doc.expires_at ? formatDocumentDate(doc.expires_at) : 'INDEFINIDA'} />
                    </div>
                 </div>

                 <div className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-[0.42rem] leading-none tracking-[0.12em] text-slate-900 sm:px-3 sm:text-[0.5rem]">
                    <p className="overflow-hidden whitespace-nowrap">{mrzLineOne}</p>
                    <p className="mt-1 overflow-hidden whitespace-nowrap">{mrzLineTwo}</p>
                 </div>
            </div>
        )}
    </DocumentContainer>
)};

const MarriageCertificateDocument = ({ user, doc }) => {
    const dateOfBirth = formatDocumentDate(user.date_of_birth);
    return (
        <div data-official-document className="p-6 bg-white rounded-lg text-black font-serif max-w-2xl mx-auto border-4 border-pink-300">
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
                <p>Celebrado em <strong>{formatDocumentDate(doc.issued_at)}</strong>, sob o regime de <strong>COMUNHÃO PARCIAL DE BENS</strong>.</p>
            </main>
            <footer className="mt-8 text-center text-xs">
                <p>GOV - RP, {formatLocaleBR(new Date(doc.issued_at), 'toLocaleDateString', 'pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}.</p>
            </footer>
        </div>
    );
};

const ClearanceCertificateDocument = ({ user, doc }) => (
    <div data-official-document className="mx-auto max-w-2xl space-y-6 rounded-lg border-4 border-emerald-700 bg-white p-6 font-serif text-black sm:p-10">
        <header className="space-y-2 text-center">
            <img src={SEAL_IMAGE} alt="Selo GOV.RP" className="mx-auto h-16 w-16 object-contain" />
            <p className="text-sm font-bold">REPÚBLICA FEDERATIVA DE GOV.RP</p>
            <p className="text-xs">CENTRAL DE SERVIÇOS JUDICIAIS</p>
            <h1 className="text-lg font-bold">ATESTADO DE ANTECEDENTES</h1>
        </header>
        <main className="space-y-4 text-sm leading-relaxed">
            <DocumentField label="CIDADÃO" value={doc.full_name || user.full_name} />
            <DocumentField label="CPF" value={formatCPF(user.cpf)} />
            <DocumentField label="PROTOCOLO" value={doc.document_number} />
            <p className="rounded border border-emerald-200 p-4 font-semibold">
                {doc.metadata?.result === 'nothing_found'
                    ? 'Não constam antecedentes criminais ativos na data de emissão deste atestado.'
                    : doc.metadata?.result === 'positive'
                        ? 'Constam registros criminais ativos na data de emissão deste atestado.'
                        : 'Resultado não informado. Consulte a Central de Serviços Judiciais.'}
            </p>
            <p>Este documento retrata os registros do cidadão no GOV.RP na data de sua emissão.</p>
            <DocumentField label="EMISSÃO" value={formatDocumentDate(doc.issued_at)} />
            <DocumentField label="VALIDADE" value={formatDocumentDate(doc.expires_at)} />
        </main>
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t pt-4 text-xs">
            <p>Documento emitido eletronicamente pelo GOV.RP.</p>
            <QRCode value={doc.qr_code_data || `GOVRP:AAC:${doc.document_number}`} size={80} />
        </footer>
    </div>
);

const ProfessionalRegistryDocument = ({ user, doc, side }) => (
    <DocumentContainer identity="professional" className="bg-gradient-to-br from-cyan-50 to-indigo-50 text-black font-sans">
        {side === 'front' ? (
            <>
                <header className="flex items-center justify-between pb-1 sm:pb-2 border-b-2 border-black">
                    <h1 className="font-bold text-[0.6rem] sm:text-base">CONSELHO PROFISSIONAL DE GOV.RP</h1>
                    <img src={SEAL_IMAGE} alt="Selo" className="h-9 w-9 object-contain sm:h-12 sm:w-12" />
                </header>
                <p className="mt-2 text-center font-bold text-[0.76rem] sm:text-lg">CARTEIRA DE IDENTIDADE PROFISSIONAL</p>
                <main className="mt-1 flex min-h-0 flex-grow gap-2 sm:gap-3">
                    <img src={user.avatar_url} alt="Foto" className="h-full min-h-0 w-1/3 object-cover border-2 border-gray-400"/>
                    <div className="w-2/3 space-y-0.5 text-[0.5rem] sm:text-[11px] p-1">
                        <DocumentField label="NOME COMPLETO" value={user.full_name?.toUpperCase()} />
                        <DocumentField label="PROFISSÃO" value={doc.metadata?.profession?.toUpperCase() || 'NÃO ESPECIFICADO'} />
                        <DocumentField label="Nº DE REGISTRO" value={doc.document_number} className="text-red-600 font-mono" />
                        <DocumentField label="CPF" value={formatCPF(user.cpf)} />
                    </div>
                </main>
                <footer className="flex shrink-0 items-end justify-between gap-3 pt-2 text-left text-[10px]">
                    <DocumentField label="DATA DE EMISSÃO" value={formatDocumentDate(doc.issued_at)} />
                    <CitizenSignature user={user} className="ml-auto shrink-0" />
                </footer>
            </>
        ) : (
            <GenericBackSide doc={doc} />
        )}
    </DocumentContainer>
);

const ReservistCertificateDocument = ({ user, doc, side }) => {
    const dateOfBirth = formatDocumentDate(user.date_of_birth);
    return (
    <DocumentContainer className="bg-gradient-to-br from-green-100 to-yellow-100 text-black font-mono">
        {side === 'front' ? (
            <>
                <header className="text-center mb-1">
                    <img src={SEAL_IMAGE} alt="Brasão da República" className="w-9 h-9 mx-auto mb-1 object-contain" />
                    <h1 className="text-[0.72rem] font-bold sm:text-sm">REPÚBLICA FEDERATIVA DE GOV.RP</h1>
                    <h2 className="text-[0.62rem] sm:text-xs">MINISTÉRIO DA DEFESA - FORÇAS ARMADAS</h2>
                </header>
                <h3 className="mb-1 text-center text-sm font-bold sm:text-base">CERTIFICADO DE RESERVISTA</h3>
                <main className="space-y-0.5 text-[10px] sm:text-xs">
                    <DocumentField label="NOME" value={user.full_name?.toUpperCase()} />
                    <DocumentField label="NASCIMENTO" value={dateOfBirth} />
                    <DocumentField label="Nº DE REGISTRO" value={doc.document_number} />
                    <p className="leading-snug">Certificamos que o cidadão acima qualificado foi dispensado do serviço militar inicial por ter sido incluído no excesso de contingente.</p>
                </main>
                <footer className="mt-1 text-center text-[10px] sm:text-xs">
                    <p>Emitido em: {formatDocumentDate(doc.issued_at)}</p>
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
      'Atestado de Antecedentes': ClearanceCertificateDocument,
  }[doc.type];

  const hasTwoSides = documentHasTwoSides(doc.type);

  if (!DocumentComponent) return null;

  const isFullPageDoc = documentIsFullPage(doc.type);
  const controls = onBack && <div data-export-ignore className="z-50 flex shrink-0 justify-end gap-2 self-end pointer-events-auto sm:flex-col sm:self-start">
    <Button title="Fechar documento" variant="destructive" size="icon" aria-label="Fechar documento" type="button" onClick={onBack} className="min-h-11 min-w-11 touch-manipulation bg-red-600 text-white hover:bg-red-700 focus-visible:ring-2 focus-visible:ring-red-300"><X className="h-5 w-5" /></Button>
    {hasTwoSides && <Button title="Virar documento" size="icon" aria-label="Virar documento" type="button" onClick={() => setSide(s => s === 'front' ? 'back' : 'front')} className="min-h-11 min-w-11 touch-manipulation bg-cyan-700 text-white hover:bg-cyan-600 focus-visible:ring-2 focus-visible:ring-cyan-300"><RefreshCw className="h-5 w-5" /></Button>}
  </div>;

  if (isFullPageDoc) {
    if (!onBack) return <DocumentComponent user={user} doc={doc} />;
    return (
        <div className="relative flex w-full max-w-[740px] flex-col-reverse gap-3 mx-auto sm:flex-row">
            <div className="min-w-0 flex-1 overflow-y-auto max-h-[75vh]">
                <DocumentComponent user={user} doc={doc} />
            </div>
            {controls}
        </div>
    );
  }

  return (
    <div className={`relative mx-auto flex w-full flex-col-reverse gap-3 sm:flex-row [&_[data-official-document]]:shadow-none ${onBack?'max-w-[526px]':'max-w-[470px]'}`}>
      <div className="min-w-0 flex-1"><DocumentComponent user={user} doc={doc} side={side}/></div>
      {controls}
    </div>
  )
};
