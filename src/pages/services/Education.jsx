import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import PageHeader from '@/components/layout/PageHeader';
import { GraduationCap, BookOpen, Award, TrendingUp, AlertTriangle, Building2, CheckCircle2, ChevronRight, Loader2, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';

const educationLevels = [
    { id: 'bachelor', title: 'Ensino Superior (Bacharelado)', duration: '4 Anos', cost: 1500, icon: Building2, color: 'text-blue-400', progress: 0, status: 'available' },
    { id: 'master', title: 'Mestrado', duration: '2 Anos', cost: 3000, icon: BookOpen, color: 'text-indigo-400', progress: 0, status: 'locked', requires: 'bachelor' },
    { id: 'phd', title: 'Doutorado', duration: '4 Anos', cost: 6000, icon: GraduationCap, color: 'text-purple-400', progress: 0, status: 'locked', requires: 'master' },
];

const jobCourses = [
    { id: 'law', title: 'Direito (OAB)', cost: 5000, duration: '6 Meses', roles: 'Advogado, Promotor, Juiz', icon: Award, color: 'text-red-400' },
    { id: 'med', title: 'Medicina (CRM)', cost: 8000, duration: '8 Meses', roles: 'Médico', icon: Award, color: 'text-emerald-400' },
    { id: 'tech', title: 'Gestão em TI', cost: 2500, duration: '3 Meses', roles: 'Especialista, Diretor TI', icon: Award, color: 'text-cyan-400' }
];

const Education = () => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [myCourses, setMyCourses] = useState([]);
    const [enrolling, setEnrolling] = useState(false);

    useEffect(() => {
        // Fetch courses enrolled by user (Mock implementation for UI demo)
        setTimeout(() => {
            setLoading(false);
        }, 1200);
    }, []);

    const handleEnroll = (courseId) => {
        setEnrolling(courseId);
        setTimeout(() => {
            setEnrolling(null);
            toast({ title: 'Matrícula Solicitada', description: `Seu pedido para o curso foi enviado para análise na tesouraria do Governo.` });
        }, 1500);
    };

    return (
        <>
            <Helmet>
                <title>Ensino Superior - GOV.RP</title>
                <meta name="description" content="Inicie sua jornada acadêmica, matricule-se no Ensino Superior e libere novas profissões." />
            </Helmet>
            
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={GraduationCap}
                    title="Ensino"
                    gradientText="Superior"
                    description="O conhecimento é o pilar da evolução em nossa nação. Avance em seus estudos."
                    iconColor="text-indigo-500"
                    centered={true}
                />

                {loading ? (
                    <div className="flex justify-center mt-20"><Loader2 className="h-10 w-10 text-indigo-500 animate-spin" /></div>
                ) : (
                    <div className="mt-12 space-y-12">
                        {/* Status Card */}
                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
                            <Card className="glass-effect overflow-hidden relative">
                                <div className="absolute top-0 right-0 w-[30rem] h-[30rem] bg-indigo-500/10 rounded-full blur-3xl -mr-32 -mt-32 pointer-events-none" />
                                <CardContent className="p-8">
                                    <div className="flex flex-col md:flex-row items-center gap-8">
                                        <div className="w-24 h-24 rounded-full bg-indigo-500/20 flex items-center justify-center border-4 border-indigo-500/30">
                                            <TrendingUp className="w-10 h-10 text-indigo-400" />
                                        </div>
                                        <div className="flex-1 text-center md:text-left">
                                            <h2 className="text-2xl font-bold text-foreground">Nível de Escolaridade: Médio Completo</h2>
                                            <p className="text-muted-foreground mt-2">Você precisa do Ensino Superior para assumir cargos de alto escalão no Governo, corporações e acessar salários melhores.</p>
                                        </div>
                                        <div className="w-full md:w-64">
                                            <div className="bg-black/40 border border-indigo-500/20 rounded-xl p-4 text-center">
                                                <p className="text-xs uppercase text-muted-foreground mb-1">Pontos Acadêmicos</p>
                                                <p className="text-3xl font-black text-indigo-400">0 / 100</p>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </motion.div>

                        <div className="space-y-6">
                            <h3 className="text-2xl font-bold flex items-center gap-2"><Building2 className="text-indigo-400" /> Trilha Acadêmica Principal</h3>
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                {educationLevels.map((lvl, index) => {
                                    const Icon = lvl.icon;
                                    const isLocked = lvl.status === 'locked';
                                    return (
                                        <motion.div key={lvl.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.1 }}>
                                            <Card className={`glass-effect h-full flex flex-col relative overflow-hidden transition-all ${isLocked ? 'opacity-60 saturate-50 pointer-events-none' : 'hover:border-indigo-500/50'}`}>
                                                {isLocked && <div className="absolute inset-0 bg-background/50 backdrop-blur-[2px] z-10 flex items-center justify-center flex-col gap-2">
                                                    <AlertTriangle className="w-8 h-8 text-muted-foreground" />
                                                    <span className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Bloqueado</span>
                                                </div>}
                                                <CardHeader className="text-center pb-2">
                                                    <div className={`mx-auto w-16 h-16 rounded-2xl bg-black/50 border border-white/5 flex items-center justify-center mb-4`}>
                                                        <Icon className={`h-8 w-8 ${lvl.color}`} />
                                                    </div>
                                                    <CardTitle className="text-xl">{lvl.title}</CardTitle>
                                                    <CardDescription>{lvl.duration} de curso intensivo</CardDescription>
                                                </CardHeader>
                                                <CardContent className="flex-grow flex flex-col justify-end pt-4">
                                                    <p className="text-center font-semibold text-lg">{formatCurrency(lvl.cost)}<span className="text-xs text-muted-foreground">/sem</span></p>
                                                </CardContent>
                                                <CardFooter>
                                                    <Button className="w-full font-semibold" variant={isLocked ? "outline" : "default"} disabled={enrolling} onClick={() => handleEnroll(lvl.id)}>
                                                        {enrolling === lvl.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Matricular-se'}
                                                    </Button>
                                                </CardFooter>
                                            </Card>
                                        </motion.div>
                                    )
                                })}
                            </div>
                        </div>

                        <div className="space-y-6 pt-6 border-t border-border">
                            <h3 className="text-2xl font-bold flex items-center gap-2"><Award className="text-emerald-400" /> Cursos Profissionalizantes de Elite</h3>
                            <p className="text-muted-foreground mb-4">Esses cursos exigem Ensino Superior e são estritamente necessários para determinadas profissões.</p>
                            
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {jobCourses.map((course, index) => {
                                    const Icon = course.icon;
                                    return (
                                        <motion.div key={course.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: index * 0.1 + 0.3 }}>
                                            <Card className="glass-effect hover:border-emerald-500/30 transition-all flex flex-col h-full bg-gradient-to-br from-background to-emerald-900/5">
                                                <CardContent className="p-6 flex-grow">
                                                    <div className="flex justify-between items-start mb-4">
                                                        <div className={`p-3 rounded-lg bg-black/40 ${course.color}`}>
                                                            <Icon className="w-6 h-6" />
                                                        </div>
                                                        <span className="text-xs font-bold uppercase tracking-wider bg-black/40 px-3 py-1 rounded-full border border-white/10">{course.duration}</span>
                                                    </div>
                                                    <h4 className="text-xl font-bold mb-2">{course.title}</h4>
                                                    <p className="text-sm text-foreground mb-4">Garante a licença para as funções:</p>
                                                    <p className="text-sm font-semibold text-emerald-400">{course.roles}</p>
                                                </CardContent>
                                                <CardFooter className="bg-black/20 p-4 border-t border-white/5 flex justify-between items-center mt-auto">
                                                    <span className="font-bold text-lg">{formatCurrency(course.cost)}</span>
                                                    <Button variant="ghost" size="sm" className="hover:bg-emerald-500/20 hover:text-emerald-400">Inscrever <ArrowRight className="w-4 h-4 ml-1" /></Button>
                                                </CardFooter>
                                            </Card>
                                        </motion.div>
                                    )
                                })}
                            </div>
                        </div>

                    </div>
                )}
            </div>
        </>
    );
};

export default Education;
