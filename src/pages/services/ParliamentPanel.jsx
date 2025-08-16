import React from 'react';
import { Helmet } from 'react-helmet-async';
import PageHeader from '@/components/layout/PageHeader';
import { Scale } from 'lucide-react';

const ParliamentPanel = () => {
    return (
        <>
            <Helmet>
                <title>Painel do Parlamento - GOV.RP</title>
            </Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={Scale}
                    title="Painel do"
                    gradientText="Parlamento"
                    description="Gerencie projetos de lei, votações e membros do parlamento."
                    iconColor="text-yellow-400"
                />
                <div className="text-center text-muted-foreground mt-16">
                    <p>Painel do Parlamento em desenvolvimento.</p>
                </div>
            </div>
        </>
    );
};

export default ParliamentPanel;