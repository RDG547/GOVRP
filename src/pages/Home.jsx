import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { Users, Shield, Zap, Globe } from 'lucide-react';
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
    { number: '0', label: 'Cidadãos', icon: Users },
    { number: '6', label: 'Serviços Disponíveis', icon: Shield },
    { number: '24/7', label: 'Disponibilidade', icon: Zap },
    { number: '0', label: 'Transações/Mês', icon: Globe }
  ]);

  useEffect(() => {
    const fetchStats = async () => {
      const { count, error } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true });

      if (error) {
        console.error("Error fetching user stats:", error);
        return;
      }

      setStats(prevStats => [
        { ...prevStats[0], number: `${count}+` },
        ...prevStats.slice(1)
      ]);
    };
    fetchStats();
  }, []);

  return (
    <>
      <Helmet>
        <title>GOV.RP - Ecossistema de Roleplay Político</title>
        <meta name="description" content="O ecossistema mais completo para roleplay político. Conecte-se, governe e construa o futuro do seu país virtual com nossos 6 serviços integrados." />
      </Helmet>

      <div className="w-full overflow-x-hidden">
        <HeroSection session={session} />
        <StatsSection stats={stats} />
        <FeaturesSection />
        <ServicesSection />
        <NewsSection />
        <TestimonialsSection />
        <CTASection />
      </div>
    </>
  );
};

export default Home;