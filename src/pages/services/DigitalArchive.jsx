import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Loader, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

const DigitalArchive = () => {
  const [redirecting, setRedirecting] = useState(true);
  const redirectUrl = 'https://mundo-dos-links.blogspot.com/';

  useEffect(() => {
    const timer = setTimeout(() => {
      window.location.href = redirectUrl;
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <Helmet>
        <title>Acervo Digital - GOV.RP</title>
        <meta name="description" content="Acessando o Acervo Digital, nosso repositório de links para jogos, softwares e cursos." />
      </Helmet>
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <Loader className="h-12 w-12 animate-spin text-blue-400" />
        <h1 className="text-3xl font-bold text-white mt-6 mb-3">Redirecionando para o Acervo Digital</h1>
        <p className="text-gray-300 max-w-md">
          Você está sendo levado ao nosso repositório parceiro de links para jogos, softwares, cursos e muito mais.
        </p>
        <p className="text-sm text-gray-500 mt-2">
          Se o redirecionamento não funcionar, clique no botão abaixo.
        </p>
        <Button 
            onClick={() => window.location.href = redirectUrl} 
            className="mt-6 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
        >
            <ExternalLink className="w-4 h-4 mr-2" />
            Acessar Acervo Agora
        </Button>
      </div>
    </>
  );
};

export default DigitalArchive;