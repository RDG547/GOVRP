import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion, AnimatePresence } from 'framer-motion';
import PageHeader from '@/components/layout/PageHeader';
import { Home, Building2, MapPin, Bath, BedDouble, Car, Plus, Search, Loader2, Key, ShieldCheck, DoorOpen } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const initialProperties = [
    { id: 1, type: 'Apartamento', address: 'Centro', price: 1200, beds: 2, baths: 1, garage: 1, img: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?q=80&w=2070&auto=format&fit=crop' },
    { id: 2, type: 'Casa', address: 'Jardins', price: 2500, beds: 3, baths: 2, garage: 2, img: 'https://images.unsplash.com/photo-1570129477492-45c003edd2be?q=80&w=2070&auto=format&fit=crop' },
    { id: 3, type: 'Comercial', address: 'Distrito Industrial', price: 3500, beds: 0, baths: 2, garage: 5, img: 'https://images.unsplash.com/photo-1556761175-b413da4baf72?q=80&w=1974&auto=format&fit=crop' },
    { id: 4, type: 'Apartamento', address: 'Praia do Sul', price: 1800, beds: 1, baths: 1, garage: 1, img: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?q=80&w=2070&auto=format&fit=crop' },
];

const Rent = () => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [properties, setProperties] = useState(initialProperties);
    const [searchTerm, setSearchTerm] = useState('');
    const [propertyType, setPropertyType] = useState('all');
    const [rentedProperty, setRentedProperty] = useState(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const serviceType = 'Aluguel';

    const fetchService = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        const { data, error } = await supabase
            .from('user_services')
            .select('*')
            .eq('user_id', user.id)
            .eq('service_type', serviceType);
        
        if (error) {
            toast({ title: 'Erro ao buscar aluguel', variant: 'destructive' });
        } else {
            setRentedProperty(data[0] || null);
        }
        setLoading(false);
    }, [user, toast]);

    useEffect(() => {
        fetchService();
    }, [fetchService]);

    const filteredProperties = useMemo(() => {
        return properties.filter(prop => 
            (prop.address.toLowerCase().includes(searchTerm.toLowerCase()) || prop.type.toLowerCase().includes(searchTerm.toLowerCase())) &&
            (propertyType === 'all' || prop.type === propertyType)
        );
    }, [properties, searchTerm, propertyType]);

    const handleRent = async (property) => {
        setActionLoading(true);
        const { data, error } = await supabase.from('user_services').insert({
            user_id: user.id,
            service_type: serviceType,
            plan_name: `${property.type} em ${property.address}`,
            price: property.price,
        }).select().single();

        if (error) {
            toast({ title: 'Erro ao alugar', variant: 'destructive' });
        } else {
            toast({ title: 'Imóvel Alugado!', description: `Você alugou o imóvel em ${property.address}.` });
            setRentedProperty(data);
        }
        setActionLoading(false);
    };

    const handleCancelRent = async () => {
        if (!rentedProperty) return;
        setActionLoading(true);
        const { error } = await supabase.from('user_services').update({is_active:false}).eq('id', rentedProperty.id);
        if (error) {
            toast({ title: 'Erro ao cancelar', variant: 'destructive' });
        } else {
            toast({ title: 'Aluguel Cancelado', variant: 'destructive' });
            setRentedProperty(null);
        }
        setActionLoading(false);
    };

    return (
        <>
            <Helmet>
                <title>Aluguel - GOV.RP</title>
                <meta name="description" content="Plataforma para aluguel de imóveis residenciais e comerciais." />
            </Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={Home}
                    title="Portal de"
                    gradientText="Aluguel"
                    description="Encontre o imóvel ideal para você, seja para morar ou para seu negócio."
                    iconColor="text-orange-400"
                    centered={true}
                />

                <div className="mt-12">
                    {loading ? (
                        <div className="flex justify-center py-20"><Loader2 className="h-12 w-12 text-orange-400 animate-spin" /></div>
                    ) : rentedProperty ? (
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }}>
                            <Card className="glass-effect overflow-hidden relative border-orange-500/20 max-w-2xl mx-auto">
                                <div className="absolute top-0 right-0 w-64 h-64 bg-orange-400/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
                                <CardHeader className="text-center pb-2">
                                    <div className="mx-auto w-20 h-20 rounded-full bg-orange-500/10 flex items-center justify-center mb-4 border border-orange-500/20">
                                        <Key className="h-10 w-10 text-orange-400" />
                                    </div>
                                    <CardTitle className="text-3xl font-bold">Seu Contrato Ativo</CardTitle>
                                    <CardDescription>Residência registrada no seu nome</CardDescription>
                                </CardHeader>
                                <CardContent className="pt-6">
                                    <div className="bg-black/40 rounded-xl p-6 border border-orange-500/10 text-center">
                                        <p className="text-sm text-muted-foreground uppercase tracking-wider mb-2">Imóvel Vigente</p>
                                        <p className="text-2xl font-bold text-white mb-4">{rentedProperty.plan_name}</p>
                                        <div className="flex justify-center items-center gap-2 mb-2">
                                            <ShieldCheck className="h-5 w-5 text-emerald-400" />
                                            <span className="text-emerald-400 font-medium">Contrato Validado no Cartório</span>
                                        </div>
                                    </div>
                                    <div className="mt-6 flex justify-between items-center bg-orange-500/5 p-4 rounded-lg">
                                        <span className="text-muted-foreground">Valor Semanal</span>
                                        <span className="text-3xl font-bold text-orange-400">{formatCurrency(rentedProperty.price)}</span>
                                    </div>
                                </CardContent>
                                <CardFooter className="justify-center pb-8 pt-4">
                                    <Button variant="destructive" className="w-full sm:w-auto px-8" onClick={handleCancelRent} disabled={actionLoading}>
                                        {actionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DoorOpen className="mr-2 h-4 w-4" />}
                                        Rescindir Contrato e Desocupar
                                    </Button>
                                </CardFooter>
                            </Card>
                        </motion.div>
                    ) : (
                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
                            <Card className="glass-effect p-6 mb-8 border-orange-500/20 bg-gradient-to-r from-background to-orange-900/10">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div className="relative md:col-span-2 group">
                                       <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground group-focus-within:text-orange-400 transition-colors" />
                                       <Input placeholder="Buscar por bairro ou características..." className="pl-12 h-12 text-lg bg-black/40 border-orange-500/20 focus-visible:ring-orange-500" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                                    </div>
                                     <Select value={propertyType} onValueChange={setPropertyType}>
                                        <SelectTrigger className="h-12 text-base bg-black/40 border-orange-500/20 focus:ring-orange-500">
                                            <SelectValue placeholder="Tipo de Imóvel" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">Todos os Imóveis</SelectItem>
                                            <SelectItem value="Apartamento">Apartamento Residencial</SelectItem>
                                            <SelectItem value="Casa">Casa Unifamiliar</SelectItem>
                                            <SelectItem value="Comercial">Sala Comercial</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </Card>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                                <AnimatePresence>
                                    {filteredProperties.map((prop, idx) => (
                                        <motion.div key={prop.id} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ delay: idx * 0.1 }}>
                                            <Card className="glass-effect overflow-hidden group hover:border-orange-500/50 hover:shadow-[0_0_30px_-5px_rgba(249,115,22,0.3)] transition-all duration-300 h-full flex flex-col">
                                                <CardHeader className="p-0 relative">
                                                    <div className="absolute top-4 left-4 z-10 flex gap-2">
                                                        <Badge className="bg-orange-500 hover:bg-orange-600 text-white shadow-lg">Disponível</Badge>
                                                        <Badge variant="secondary" className="bg-black/60 backdrop-blur-md text-white border-0 shadow-lg font-medium">
                                                            {prop.type === 'Comercial' ? <Building2 className="mr-1 h-3 w-3" /> : <Home className="mr-1 h-3 w-3" />} {prop.type}
                                                        </Badge>
                                                    </div>
                                                    <div className="aspect-video overflow-hidden relative">
                                                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent z-[5]"></div>
                                                        <img src={prop.img} alt={prop.type} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
                                                        <div className="absolute bottom-4 left-4 z-10">
                                                            <div className="flex items-center gap-2 text-white/90">
                                                                <MapPin className="h-4 w-4 text-orange-400" />
                                                                <span className="font-medium text-lg drop-shadow-md">{prop.address}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </CardHeader>
                                                <CardContent className="p-6 flex-grow flex flex-col justify-center">
                                                    <div className="flex justify-between items-center mb-4">
                                                        <div className="text-3xl font-black text-white">{formatCurrency(prop.price)}<span className="text-sm font-normal text-muted-foreground">/semana</span></div>
                                                    </div>
                                                    
                                                    <div className="flex items-center gap-4 text-muted-foreground text-sm pt-4 border-t border-white/10">
                                                        {prop.beds > 0 && <div className="flex items-center gap-2 bg-black/30 px-3 py-1.5 rounded-md flex-1 justify-center"><BedDouble className="h-4 w-4 text-orange-400"/> <span className="font-semibold text-white">{prop.beds}</span></div>}
                                                        {prop.baths > 0 && <div className="flex items-center gap-2 bg-black/30 px-3 py-1.5 rounded-md flex-1 justify-center"><Bath className="h-4 w-4 text-orange-400"/> <span className="font-semibold text-white">{prop.baths}</span></div>}
                                                        {prop.garage > 0 && <div className="flex items-center gap-2 bg-black/30 px-3 py-1.5 rounded-md flex-1 justify-center"><Car className="h-4 w-4 text-orange-400"/> <span className="font-semibold text-white">{prop.garage}</span></div>}
                                                    </div>
                                                </CardContent>
                                                <CardFooter className="p-0">
                                                    <Button 
                                                        className="w-full rounded-t-none h-14 text-lg font-bold bg-orange-500/10 text-orange-400 hover:bg-orange-500 hover:text-white transition-all duration-300"
                                                        onClick={() => handleRent(prop)} 
                                                        disabled={actionLoading}
                                                    >
                                                        {actionLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Key className="mr-2 h-5 w-5" />}
                                                        Assinar Contrato
                                                    </Button>
                                                </CardFooter>
                                            </Card>
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                            </div>
                            
                            {filteredProperties.length === 0 && (
                                <div className="text-center py-20 bg-black/20 rounded-2xl border border-white/5 mt-8">
                                    <Home className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
                                    <h3 className="text-xl font-bold text-white mb-2">Nenhum imóvel listado</h3>
                                    <p className="text-muted-foreground">Tente alterar os filtros de busca para encontrar disponibilidades.</p>
                                </div>
                            )}
                        </motion.div>
                    )}
                </div>
            </div>
        </>
    );
};

export default Rent;