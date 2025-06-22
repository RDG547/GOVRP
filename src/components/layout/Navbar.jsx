
import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Menu, X, Building2 } from 'lucide-react';

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);

  const navLinks = [
    { name: 'Início', path: '/' },
    { name: 'Sobre', path: '/sobre' },
    { name: 'Contato', path: '/contato' },
  ];

  const servicesLinks = [
    { name: 'Banco', path: '/servicos/banco' },
    { name: 'Negócios Livres', path: '/servicos/negocios-livres' },
    { name: 'DIC', path: '/servicos/dic' },
    { name: 'Social X', path: '/servicos/x' },
    { name: 'Biblioteca Nacional', path: '/servicos/biblioteca-nacional' },
    { name: 'Acervo Digital', path: '/servicos/acervo-digital' },
  ];

  const activeLinkClass = "text-primary font-semibold";
  const inactiveLinkClass = "hover:text-primary transition-colors duration-300";

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <Building2 className="h-6 w-6 text-primary" />
          <span className="font-bold text-lg">GOV.RP</span>
        </Link>

        <nav className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <NavLink
              key={link.name}
              to={link.path}
              className={({ isActive }) => (isActive ? activeLinkClass : inactiveLinkClass)}
            >
              {link.name}
            </NavLink>
          ))}
          <div className="relative group">
            <span className={`${inactiveLinkClass} cursor-pointer`}>Serviços</span>
            <div className="absolute top-full left-0 mt-2 w-48 bg-background border border-border rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 invisible group-hover:visible">
              {servicesLinks.map((link) => (
                <NavLink
                  key={link.name}
                  to={link.path}
                  className="block px-4 py-2 text-sm hover:bg-accent"
                >
                  {link.name}
                </NavLink>
              ))}
            </div>
          </div>
        </nav>

        <div className="hidden md:flex items-center gap-2">
          <Button variant="ghost" asChild>
            <Link to="/login">Login</Link>
          </Button>
          <Button asChild>
            <Link to="/registro">Registrar</Link>
          </Button>
        </div>

        <div className="md:hidden">
          <Button variant="ghost" size="icon" onClick={() => setIsOpen(!isOpen)}>
            {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </Button>
        </div>
      </div>

      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="md:hidden pb-4"
        >
          <nav className="flex flex-col items-center gap-4">
            {navLinks.map((link) => (
              <NavLink key={link.name} to={link.path} onClick={() => setIsOpen(false)} className={({ isActive }) => (isActive ? activeLinkClass : inactiveLinkClass)}>
                {link.name}
              </NavLink>
            ))}
            <div className="text-center">
              <span className={`${inactiveLinkClass} cursor-pointer`}>Serviços</span>
              <div className="mt-2 flex flex-col gap-2">
                {servicesLinks.map((link) => (
                  <NavLink key={link.name} to={link.path} onClick={() => setIsOpen(false)} className="hover:text-primary">
                    {link.name}
                  </NavLink>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2 w-full px-4 mt-4">
              <Button variant="ghost" asChild className="w-full">
                <Link to="/login" onClick={() => setIsOpen(false)}>Login</Link>
              </Button>
              <Button asChild className="w-full">
                <Link to="/registro" onClick={() => setIsOpen(false)}>Registrar</Link>
              </Button>
            </div>
          </nav>
        </motion.div>
      )}
    </header>
  );
};

export default Navbar;
  