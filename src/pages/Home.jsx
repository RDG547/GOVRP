import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { Users, Landmark, MessageSquare, ArrowRightLeft, Server, Clock, Flag } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';

import HeroSection from '@/components/home/HeroSection';
import StatsSection from '@/components/home/StatsSection';
import FeaturesSection from '@/components/home/FeaturesSection';
import ServicesSection from '@/components/home/ServicesSection';
import NewsSection from '@/components/home/NewsSection';
import TestimonialsSection from '@/components/home/TestimonialsSection';
import CTASection from '@/components/home/CTASection';

const Home = () => {
  const { session } = useAuth();
  const [stats, setStats] = useState([
    { number: '0', label: 'Cidadãos Registrados', icon: Users },
    { number: '13', label: 'Serviços Disponíveis', icon: Server },
    { number: '24/7', label: 'Disponibilidade', icon: Clock },
    { number: '0', label: 'Partidos Existentes', icon: Flag },
    { number: '0', label: 'Posts na Rede X', icon: MessageSquare },
    { number: '0', label: 'Transações Realizadas', icon: ArrowRightLeft },
  ]);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const { data, error } = await supabase.rpc('get_public_dashboard_stats');
        
        if (error) {
            console.error("Error fetching public stats:", error);
            return;
        }

        if (data) {
          setStats([
            { number: `${data.total_users || 0}+`, label: 'Cidadãos Registrados', icon: Users },
            { number: '13', label: 'Serviços Disponíveis', icon: Server },
            { number: '24/7', label: 'Disponibilidade', icon: Clock },
            { number: `${data.total_parties || 0}+`, label: 'Partidos Existentes', icon: Flag },
            { number: `${data.total_posts || 0}+`, label: 'Posts na Rede X', icon: MessageSquare },
            { number: `${data.total_transactions || 0}+`, label: 'Transações Realizadas', icon: ArrowRightLeft },
          ]);
        }
      } catch (e) {
        console.error("Exception fetching stats:", e);
      }
    };
    fetchStats();
  }, []);

  return (
    <>
      <Helmet>
        <title>GOV.RP - Ecossistema de Roleplay Político</title>
        <meta name="description" content="O ecossistema mais completo para roleplay político. Conecte-se, governe e construa o futuro do seu país virtual com nossos serviços integrados." />
      </Helmet>

      <div className="w-full overflow-x-hidden">
        <HeroSection session={session} />
        <FeaturesSection />
        <ServicesSection />
        <NewsSection />
        <TestimonialsSection />
        <StatsSection stats={stats} />
        <CTASection />
      </div>
    </>
  );
};

export default Home;