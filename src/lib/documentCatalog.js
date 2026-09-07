import { Fingerprint, FileText, Car, Globe, Building, Briefcase, Vote, ShieldCheck, Heart, Award } from 'lucide-react';

export const documentCatalog = {
    CPF: { name: 'Cadastro de Pessoa Física', icon: Fingerprint, color: 'text-purple-400' },
    RG: { name: 'Registro Geral', icon: FileText, color: 'text-purple-400' },
    CNH: { name: 'Carteira Nacional de Habilitação', icon: Car, color: 'text-blue-400' },
    Passport: { name: 'Passaporte', icon: Globe, color: 'text-green-400' },
    CNPJ: { name: 'Cadastro Nacional da Pessoa Jurídica', icon: Building, color: 'text-yellow-400' },
    CTD: { name: 'Carteira de Trabalho Digital', icon: Briefcase, color: 'text-indigo-400' },
    'Título de Eleitor': { name: 'Título de Eleitor', icon: Vote, color: 'text-teal-400' },
    'Certificado de Reservista': { name: 'Certificado de Reservista', icon: ShieldCheck, color: 'text-orange-400' },
    'Certidão de Casamento': { name: 'Certidão de Casamento', fullPage: true, icon: Heart, color: 'text-pink-400' },
    'Atestado de Antecedentes': { name: 'Atestado de Antecedentes', icon: ShieldCheck, color: 'text-emerald-400', fullPage: true },
    'Registro Profissional': { name: 'Registro Profissional', icon: Award, color: 'text-cyan-400' },
};

export const documentHasTwoSides = type => !documentCatalog[type]?.fullPage;
export const documentIsFullPage = type => Boolean(documentCatalog[type]?.fullPage);
