import React, { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { Loader } from 'lucide-react';

const Library = () => {
  useEffect(() => {
    window.location.href = 'https://baixe-books.blogspot.com/';
  }, []);

  return (
    <>
      <Helmet>
        <title>Redirecionando... - GOV.RP</title>
      </Helmet>
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <Loader className="h-12 w-12 animate-spin text-primary" />
        <h1 className="text-2xl font-semibold">Redirecionando para a Biblioteca Nacional...</h1>
        <p className="text-muted-foreground">Você será redirecionado em instantes.</p>
      </div>
    </>
  );
};

export default Library;