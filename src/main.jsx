import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import App from '@/App';
import '@/index.css';
import 'react-phone-number-input/style.css';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { CartProvider } from '@/contexts/CartContext';
import { Toaster } from '@/components/ui/toaster';

ReactDOM.createRoot(document.getElementById('root')).render(
  // Removido React.StrictMode para evitar renderizações duplas em desenvolvimento que causam toasts duplicados.
  <HelmetProvider>
    <BrowserRouter>
      <ThemeProvider>
          <Toaster />
          <CartProvider>
              <App />
          </CartProvider>
      </ThemeProvider>
    </BrowserRouter>
  </HelmetProvider>
);