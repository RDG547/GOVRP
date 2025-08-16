import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Button } from '@/components/ui/button';
import { FileWarning, ShieldQuestion, Gavel, FileText, Megaphone, Search, BookUser, HeartHandshake as Handshake, Award, Users, MessageSquare as MessageSquareWarning, FileUp, FileDown, Scale, Ticket, CalendarCheck, ShieldAlert, ShieldOff, Eye, Info, FileBadge, FileCheck } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const ServiceButton = ({ title, description, icon: Icon }) => {
    const { toast } = useToast();
    const handleClick = () => {
        toast({
            title: "🚧 Funcionalidade em Desenvolvimento",
            description: "Este serviço para cidadãos ainda não está disponível.",
        });
    };

    return (
        <button onClick={handleClick} className="w-full text-left p-4 rounded-lg bg-white/5 hover:bg-white/10 transition-all duration-200 flex items-start gap-4">
            <div className="p-2 bg-blue-500/20 rounded-md">
                <Icon className="w-6 h-6 text-blue-400" />
            </div>
            <div>
                <h4 className="font-semibold text-white">{title}</h4>
                <p className="text-sm text-muted-foreground">{description}</p>
            </div>
        </button>
    );
};

const Police = () => {
    const serviceSections = [
        {
            value: "ocorrencias",
            label: "Ocorrências",
            icon: FileWarning,
            services: [
                { title: 'Denúncias de crimes', description: 'Registre um boletim de ocorrência para crimes comuns.', icon: FileUp },
                { title: 'Denúncias anônimas', description: 'Reporte atividades suspeitas sem se identificar.', icon: ShieldOff },
            ]
        },
        {
            value: "consultas",
            label: "Consultas",
            icon: ShieldQuestion,
            services: [
                { title: 'Acompanhar boletim de ocorrência', description: 'Verifique o status de uma ocorrência registrada.', icon: FileDown },
                { title: 'Consultar mandado de prisão', description: 'Verifique se há mandados de prisão em seu nome.', icon: Gavel },
                { title: 'Verificar nome em investigação', description: 'Consulte se seu nome está em alguma investigação policial.', icon: Search },
                { title: 'Solicitar certidão negativa', description: 'Emita uma certidão de antecedentes criminais.', icon: FileBadge },
            ]
        },
        {
            value: "solicitacoes",
            label: "Solicitações",
            icon: FileText,
            services: [
                { title: 'Pedido de investigação formal', description: 'Solicite uma investigação contra autoridades ou empresas.', icon: Scale },
                { title: 'Requisição de liberação de bens', description: 'Peça a devolução de itens apreendidos em operações.', icon: Handshake },
                { title: 'Pedido de atestado de antecedentes', description: 'Emita seu atestado de antecedentes criminais.', icon: FileCheck },
            ]
        },
        {
            value: "multas",
            label: "Multas",
            icon: Ticket,
            services: [
                { title: 'Consultar multas recebidas', description: 'Verifique todas as multas registradas em seu nome.', icon: Ticket },
                { title: 'Solicitar recurso de multa', description: 'Conteste uma multa que considera indevida.', icon: MessageSquareWarning },
                { title: 'Agendar audiência com a corregedoria', description: 'Marque uma audiência para discutir penalidades.', icon: CalendarCheck },
            ]
        },
        {
            value: "corregedoria",
            label: "Corregedoria",
            icon: ShieldAlert,
            services: [
                { title: 'Denunciar abuso de autoridade', description: 'Reporte casos de abuso por parte de oficiais.', icon: ShieldAlert },
                { title: 'Denunciar corrupção ou prevaricação', description: 'Faça uma denúncia sobre atos de corrupção policial.', icon: ShieldAlert },
                { title: 'Solicitar investigação da Corregedoria', description: 'Peça uma investigação interna sobre a conduta policial.', icon: ShieldAlert },
            ]
        },
        {
            value: "informacoes",
            label: "Informações",
            icon: Info,
            services: [
                { title: 'Ver lista de procurados', description: 'Acesse a lista pública de foragidos da justiça.', icon: Users },
                { title: 'Campanhas e Educação', description: 'Acesse informativos sobre leis e direitos do cidadão.', icon: BookUser },
                { title: 'Ranking de eficiência da polícia', description: 'Veja as estatísticas de desempenho da polícia.', icon: Award },
            ]
        },
    ];

    return (
        <>
            <Helmet>
                <title>Serviços da Polícia - GOV.RP</title>
                <meta name="description" content="Acesse os serviços online do Departamento de Polícia." />
            </Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={FileWarning}
                    title="Polícia Civil"
                    gradientText="Serviços ao Cidadão"
                    description="Utilize os serviços da polícia para registrar e consultar ocorrências, solicitar documentos e muito mais, de forma rápida e segura."
                    iconColor="text-blue-500"
                />

                <Tabs defaultValue="ocorrencias" className="w-full">
                    <TabsList className="grid w-full grid-cols-2 md:grid-cols-3 lg:grid-cols-6 h-auto">
                        {serviceSections.map((section) => (
                            <TabsTrigger key={section.value} value={section.value} className="flex flex-col sm:flex-row gap-2 items-center justify-center py-3">
                                <section.icon className="w-5 h-5" />
                                <span>{section.label}</span>
                            </TabsTrigger>
                        ))}
                    </TabsList>

                    {serviceSections.map((section) => (
                        <TabsContent key={section.value} value={section.value}>
                            <Card className="glass-effect mt-6">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-3 text-2xl">
                                        <section.icon className="w-8 h-8 text-blue-400" />
                                        {section.label}
                                    </CardTitle>
                                    <CardDescription>Selecione um dos serviços abaixo para continuar.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {section.services.map((service, index) => (
                                            <ServiceButton key={index} {...service} />
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

export default Police;