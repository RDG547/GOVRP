import React from 'react';
import { Link } from 'react-router-dom';
import { Building2, Twitter, Instagram, Facebook } from 'lucide-react';

const Footer = () => {
  const footerLinks = [
    { name: 'Termos de Serviço', path: '/termos' },
    { name: 'Política de Privacidade', path: '/privacidade' },
    { name: 'Roadmap', path: '/roadmap' },
    { name: 'Contato', path: '/contato' },
  ];

  const socialLinks = [
    { icon: <Twitter className="h-5 w-5" />, href: '#' },
    { icon: <Instagram className="h-5 w-5" />, href: '#' },
    { icon: <Facebook className="h-5 w-5" />, href: '#' },
  ];

  return (
    <footer className="border-t border-border/40 bg-background/95">
      <div className="container py-8">
        <div className="flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex flex-col items-center md:items-start gap-2">
            <Link to="/" className="flex items-center gap-2">
              <Building2 className="h-6 w-6 text-primary" />
              <span className="font-bold text-lg">GOV.RP</span>
            </Link>
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} GOV.RP. Todos os direitos reservados.
            </p>
          </div>
          <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            {footerLinks.map((link) => (
              <Link
                key={link.name}
                to={link.path}
                className="text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                {link.name}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-4">
            {socialLinks.map((social, index) => (
              <a
                key={index}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-primary transition-colors"
              >
                {social.icon}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;