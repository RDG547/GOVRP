import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import PageHeader from '@/components/layout/PageHeader';
import { Home, Building2, MapPin, Bath, BedDouble, Car, Plus, Search, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency } from '@/lib/utils';

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
        setLoading(true);
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
        setLoading(false);
    };

    const handleCancelRent = async () => {
        if (!rentedProperty) return;
        setLoading(true);
        const { error } = await supabase.from('user_services').delete().eq('id', rentedProperty.id);
        if (error) {
            toast({ title: 'Erro ao cancelar', variant: 'destructive' });
        } else {
            toast({ title: 'Aluguel Cancelado', variant: 'destructive' });
            setRentedProperty(null);
        }
        setLoading(false);
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

                {loading ? <div className="flex justify-center mt-8"><Loader2 className="h-8 w-8 animate-spin" /></div> :
                rentedProperty ? (
                    <Card className="glass-effect mt-8 text-center">
                        <CardHeader>
                            <CardTitle>Seu Imóvel Alugado</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-xl font-semibold">{rentedProperty.plan_name}</p>
                            <p className="text-lg text-primary">{formatCurrency(rentedProperty.price)}/semana</p>
                        </CardContent>
                        <CardFooter className="justify-center">
                            <Button variant="destructive" onClick={handleCancelRent} disabled={loading}>
                                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Cancelar Aluguel
                            </Button>
                        </CardFooter>
                    </Card>
                ) : (
                    <>
                        <Card className="glass-effect mt-8 p-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="relative md:col-span-2">
                                   <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                                   <Input placeholder="Buscar por bairro ou tipo..." className="pl-10" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                                </div>
                                 <Select value={propertyType} onValueChange={setPropertyType}>
                                    <SelectTrigger><SelectValue placeholder="Tipo de Imóvel" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">Todos os Tipos</SelectItem>
                                        <SelectItem value="Apartamento">Apartamento</SelectItem>
                                        <SelectItem value="Casa">Casa</SelectItem>
                                        <SelectItem value="Comercial">Comercial</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </Card>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mt-8">
                            {filteredProperties.map(prop => (
                                <Card key={prop.id} className="glass-effect overflow-hidden group">
                                    <CardHeader className="p-0">
                                        <div className="aspect-video overflow-hidden">
                                           <img src={prop.img} alt={prop.type} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                                        </div>
                                    </CardHeader>
                                    <CardContent className="p-4">
                                        <Badge variant="secondary" className="mb-2">{prop.type === 'Comercial' ? <Building2 className="mr-1 h-3 w-3" /> : <Home className="mr-1 h-3 w-3" />} {prop.type}</Badge>
                                        <CardTitle className="text-xl">{prop.type} em {prop.address}</CardTitle>
                                        <div className="flex items-center gap-4 text-muted-foreground text-sm mt-2">
                                            {prop.beds > 0 && <span className="flex items-center gap-1"><BedDouble className="h-4 w-4"/> {prop.beds}</span>}
                                            {prop.baths > 0 && <span className="flex items-center gap-1"><Bath className="h-4 w-4"/> {prop.baths}</span>}
                                            {prop.garage > 0 && <span className="flex items-center gap-1"><Car className="h-4 w-4"/> {prop.garage}</span>}
                                        </div>
                                    </CardContent>
                                    <CardFooter className="flex justify-between items-center p-4 bg-black/10">
                                        <p className="text-lg font-bold text-primary">{formatCurrency(prop.price)}/semana</p>
                                        <Button onClick={() => handleRent(prop)} disabled={loading}>Alugar</Button>
                                    </CardFooter>
                                </Card>
                            ))}
                        </div>
                         {filteredProperties.length === 0 && (
                            <div className="text-center py-16 text-muted-foreground">
                                <p className="text-lg">Nenhum imóvel encontrado com os filtros atuais.</p>
                            </div>
                        )}
                    </>
                )}
            </div>
        </>
    );
};

export default Rent;