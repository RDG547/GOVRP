import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ShieldCheck, UserCheck, HeartPulse, Home, Radio, Search, FileText, Flag, Map, Info, UserPlus, Loader2 } from 'lucide-react';

const ServiceActionDialog = ({ title, description, icon: Icon, children, onAction, actionLabel, actionLoading }) => {
    const [isOpen, setIsOpen] = useState(false);

    const handleAction = async (e) => {
        e.preventDefault();
        const success = await onAction(e);
        if (success) {
            setIsOpen(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <button className="w-full text-left p-4 rounded-lg bg-white/5 hover:bg-white/10 transition-all duration-200 flex items-start gap-4">
                    <div className="p-2 bg-emerald-500/20 rounded-md"><Icon className="w-6 h-6 text-emerald-400" /></div>
                    <div><h4 className="font-semibold text-white">{title}</h4><p className="text-sm text-muted-foreground">{description}</p></div>
                </button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleAction}>
                    <div className="py-4">{children}</div>
                    <DialogFooter>
                        <Button type="submit" disabled={actionLoading}>
                            {actionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {actionLabel || title}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

const ArmedForces = () => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({});

    const handleInputChange = (e) => {
        const { id, value } = e.target;
        setFormData(prev => ({ ...prev, [id]: value }));
    };

    const handleGenericAction = async (actionName, payload, successMessage) => {
        setLoading(true);
        // This is a placeholder for actual API calls
        await new Promise(resolve => setTimeout(resolve, 1000));
        toast({ title: "Sucesso", description: successMessage });
        console.log(actionName, payload);
        setLoading(false);
        return true;
    };

    const serviceSections = [
        {
            value: "alistamento", label: "Alistamento e Carreira", icon: UserPlus,
            services: [
                { title: 'Alistamento Militar Obrigatório', description: 'Cumpra seu dever cívico e inicie sua jornada.', icon: UserPlus, action: 'enlist', form: <p>Confirme para iniciar seu alistamento obrigatório.</p>, actionLabel: 'Alistar-se' },
                { title: 'Consultar Situação Militar', description: 'Verifique seu status no serviço militar.', icon: Search, action: 'check_status', form: <p>Sua situação militar atual será exibida.</p>, actionLabel: 'Consultar' },
                { title: 'Certificado de Reservista', description: 'Emita seu certificado de dispensa ou de reservista.', icon: FileText, action: 'get_certificate', form: <p>O sistema verificará sua elegibilidade e emitirá o certificado.</p>, actionLabel: 'Emitir Certificado' }
            ]
        },
        {
            value: "servicos", label: "Serviços e Benefícios", icon: HeartPulse,
            services: [
                { title: 'Moradia Militar', description: 'Acesse programas de moradia para militares e suas famílias.', icon: Home, action: 'housing_info', form: <p>Informações sobre moradias disponíveis serão exibidas.</p>, actionLabel: 'Consultar Moradias' },
                { title: 'Saúde Militar', description: 'Agende consultas e acesse o sistema de saúde das Forças Armadas.', icon: HeartPulse, action: 'health_info', form: <p>Acesse o portal de saúde para mais informações.</p>, actionLabel: 'Portal de Saúde' },
                { title: 'Pensão Militar', description: 'Informações e requerimentos sobre pensões para militares e seus dependentes.', icon: UserCheck, action: 'pension_info', form: <p>Consulte as regras e faça seu requerimento.</p>, actionLabel: 'Consultar Pensões' }
            ]
        },
        {
            value: "operacoes", label: "Operações e Inteligência", icon: Flag,
            services: [
                { title: 'Operações em Andamento', description: 'Consulte informações públicas sobre as operações atuais.', icon: Flag, action: 'ongoing_ops', form: <p>Serão listadas as operações em andamento.</p>, actionLabel: 'Consultar' },
                { title: 'Relatórios de Inteligência', description: 'Acesse resumos de inteligência desclassificados.', icon: FileText, action: 'intel_reports', form: <p>Exibirá relatórios de inteligência públicos.</p>, actionLabel: 'Acessar Relatórios' },
                { title: 'Mapa Estratégico', description: 'Visualize o mapa com áreas de interesse e operações.', icon: Map, action: 'strategic_map', form: <p>O mapa estratégico será carregado.</p>, actionLabel: 'Ver Mapa' }
            ]
        },
        {
            value: "denuncias", label: "Canal de Denúncias", icon: Radio,
            services: [
                { title: 'Denúncia de Má Conduta', description: 'Reporte violações e má conduta de forma segura.', icon: Radio, action: 'report_misconduct', form: <div className="space-y-4"><Label htmlFor="details">Detalhes da Denúncia</Label><Textarea id="details" placeholder="Descreva o ocorrido com o máximo de detalhes possível." onChange={handleInputChange} /></div>, actionLabel: 'Enviar Denúncia' }
            ]
        },
        {
            value: "recrutamento", label: "Recrutamento", icon: Info,
            services: [
                { title: 'Concursos e Seleções', description: 'Veja os concursos abertos para carreira militar.', icon: UserPlus, action: 'view_contests', form: <p>Serão listados todos os concursos e processos seletivos abertos.</p>, actionLabel: 'Ver Concursos' },
                { title: 'Escolas Militares', description: 'Conheça as instituições de formação das Forças Armadas.', icon: Home, action: 'view_schools', form: <p>Informações sobre as escolas militares serão exibidas.</p>, actionLabel: 'Conhecer Escolas' },
                { title: 'Plano de Carreira', description: 'Descubra as possibilidades de carreira e progressão.', icon: Flag, action: 'career_plan', form: <p>O plano de carreira detalhado será apresentado.</p>, actionLabel: 'Ver Plano' }
            ]
        }
    ];

    return (
        <>
            <Helmet>
                <title>Forças Armadas - GOV.RP</title>
                <meta name="description" content="Serviços ao cidadão e militares das Forças Armadas." />
            </Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={ShieldCheck}
                    title="Forças"
                    gradientText="Armadas"
                    description="Defendendo a soberania e a segurança da nação. Serviços para cidadãos e militares."
                    iconColor="text-emerald-400"
                    centered={true}
                />
                <Tabs defaultValue="alistamento" className="w-full">
                    <TabsList className="grid w-full grid-cols-2 md:grid-cols-5 h-auto">
                        {serviceSections.map((section) => (
                            <TabsTrigger key={section.value} value={section.value} className="flex flex-col sm:flex-row gap-2 items-center justify-center py-3">
                                <section.icon className="w-5 h-5" /><span>{section.label}</span>
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    {serviceSections.map((section) => (
                        <TabsContent key={section.value} value={section.value}>
                            <Card className="glass-effect mt-6">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-3 text-2xl"><section.icon className="w-8 h-8 text-emerald-400" />{section.label}</CardTitle>
                                    <CardDescription>Selecione um dos serviços abaixo para continuar.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {section.services.map((service, index) => (
                                            <ServiceActionDialog
                                                key={index}
                                                {...service}
                                                onAction={() => handleGenericAction(service.action, formData, `${service.title} executado com sucesso.`)}
                                                actionLoading={loading}
                                            >
                                                {service.form}
                                            </ServiceActionDialog>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>
                    ))}
                </Tabs>
            </div>
        </>
    );
};

export default ArmedForces;