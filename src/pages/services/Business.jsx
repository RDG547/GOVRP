import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { ShoppingCart, Search, PlusCircle, Loader2, Briefcase } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import PageHeader from '@/components/layout/PageHeader';

const Business = () => {
  const { toast } = useToast();
  const { session } = useAuth();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const fetchProducts = async () => {
      setLoading(true);
      let query = supabase.from('products').select('*, seller:profiles(username)');
      if (searchTerm) {
        query = query.ilike('name', `%${searchTerm}%`);
      }
      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) {
        console.error("Error fetching products:", error);
        toast({ title: "Erro", description: "Não foi possível carregar os produtos.", variant: "destructive" });
      } else {
        setProducts(data);
      }
      setLoading(false);
    };
    
    const searchTimeout = setTimeout(() => {
      fetchProducts();
    }, 300);

    return () => clearTimeout(searchTimeout);
  }, [searchTerm, toast]);

  const handleAction = () => {
    toast({
      title: "🚧 Funcionalidade em desenvolvimento!",
      description: "Este recurso ainda não foi implementado. Volte em breve!",
    });
  };

  return (
    <>
      <Helmet>
        <title>Negócios Livres - GOV.RP</title>
        <meta name="description" content="Marketplace do GOV.RP para compra e venda de produtos e serviços." />
      </Helmet>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <PageHeader
            icon={Briefcase}
            title="Negócios"
            gradientText="Livres"
            description="O marketplace oficial do GOV.RP para compra e venda de produtos e serviços."
            iconColor="text-blue-400"
          />
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-12">
            <div>
            </div>
            {session && (
              <Button onClick={handleAction} className="mt-4 md:mt-0 bg-gradient-to-r from-blue-600 to-purple-600">
                <PlusCircle className="w-5 h-5 mr-2" /> Anunciar Produto
              </Button>
            )}
          </div>

          <div className="relative mb-8">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              type="text"
              placeholder="O que você está procurando?"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-6 text-lg bg-white/5 border-white/10 rounded-lg"
            />
          </div>

          {loading ? (
            <div className="flex justify-center items-center min-h-[40vh]">
              <Loader2 className="w-12 h-12 animate-spin text-blue-400" />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
              {products.length > 0 ? products.map((product, index) => (
                <motion.div key={product.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
                  <Card className="glass-effect h-full flex flex-col overflow-hidden group">
                    <CardHeader className="p-0">
                      <div className="aspect-video bg-gray-700 overflow-hidden">
                        <img src={product.image_url || 'https://images.unsplash.com/photo-1559223669-e0065fa7f142'} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      </div>
                      <div className="p-4">
                        <CardTitle className="text-lg text-white truncate">{product.name}</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 flex-grow">
                      <p className="text-sm text-gray-400">Vendido por: {product.seller.username}</p>
                    </CardContent>
                    <CardFooter className="p-4 flex justify-between items-center">
                      <p className="text-xl font-bold gradient-text">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(product.price)}</p>
                      <Button onClick={handleAction} size="sm"><ShoppingCart className="w-4 h-4 mr-2" /> Comprar</Button>
                    </CardFooter>
                  </Card>
                </motion.div>
              )) : (
                <div className="col-span-full text-center py-16">
                  <p className="text-gray-400">Nenhum produto encontrado.</p>
                </div>
              )}
            </div>
          )}
        </motion.div>
      </div>
    </>
  );
};

export default Business;