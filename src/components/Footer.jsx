import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Github, Mail, Heart, HelpCircle, LifeBuoy, BookOpen, Newspaper, HeartHandshake as Handshake, Landmark, Briefcase, FileText, Library, Bot, MessageSquare, ChevronUp, Users, Scroll } from 'lucide-react';
import { FaWhatsapp, FaDiscord } from 'react-icons/fa';


const Footer = () => {
  const currentYear = new Date().getFullYear();
  const [moreServicesOpen, setMoreServicesOpen] = useState(false);
  const dropdownRef = useRef(null);

  const footerLink = "flex items-center gap-2 text-gray-300 hover:text-blue-400 transition-colors duration-300";
  const socialLink = "text-gray-400 hover:text-white transition-colors duration-300";

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setMoreServicesOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownRef]);

  return (
    <footer className="bg-slate-900/50 backdrop-blur-lg border-t border-white/10 mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
          <div className="col-span-1 md:col-span-2 lg:col-span-1">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mb-4"
            >
              <Link to="/" className="text-3xl font-bold gradient-text">GOV.RP</Link>
            </motion.div>
            <p className="text-gray-400 mb-6 text-sm leading-relaxed">
              O ecossistema definitivo para roleplay político.
            </p>
            <div className="flex space-x-5 items-center">
              <motion.a whileHover={{ scale: 1.2, y: -2 }} href="https://github.com" target="_blank" rel="noopener noreferrer" className={socialLink}>
                <Github className="w-5 h-5" />
              </motion.a>
              <motion.a whileHover={{ scale: 1.2, y: -2 }} href="https://chat.whatsapp.com/KKqiDj1HyxM97NK9YAFNnj" target="_blank" rel="noopener noreferrer" className={socialLink}>
                <FaWhatsapp size={22} />
              </motion.a>
              <motion.a whileHover={{ scale: 1.2, y: -2 }} href="https://discord.gg/NwJuuzKbUU" target="_blank" rel="noopener noreferrer" className={socialLink}>
                <FaDiscord size={22} />
              </motion.a>
              <motion.a whileHover={{ scale: 1.2, y: -2 }} href="/contact" className={socialLink}>
                <Mail className="w-5 h-5" />
              </motion.a>
            </div>
          </div>

          <div>
            <span className="text-white font-semibold mb-4 block">Navegação</span>
            <div className="space-y-3">
              <Link to="/about" className={footerLink}><BookOpen className="w-4 h-4"/> Sobre Nós</Link>
              <Link to="/community" className={footerLink}><Users className="w-4 h-4"/> Comunidade</Link>
              <Link to="/news" className={footerLink}><Newspaper className="w-4 h-4"/> Notícias</Link>
              <Link to="/contact" className={footerLink}><Handshake className="w-4 h-4"/> Contato</Link>
              <Link to="/docs" className={footerLink}><Scroll className="w-4 h-4"/> Documentação</Link>
            </div>
          </div>

          <div>
            <span className="text-white font-semibold mb-4 block">Serviços</span>
            <div className="space-y-3">
              <Link to="/services/bank" className={footerLink}><Landmark className="w-4 h-4"/> Banco Nacional</Link>
              <Link to="/services/business" className={footerLink}><Briefcase className="w-4 h-4"/> Negócios Livres</Link>
              <Link to="/services/dic" className={footerLink}><FileText className="w-4 h-4"/> DIC</Link>
              <Link to="/services/x" className={footerLink}><MessageSquare className="w-4 h-4"/> X</Link>
              <div className="relative" ref={dropdownRef}>
                <button onClick={() => setMoreServicesOpen(!moreServicesOpen)} className={`${footerLink} w-full`}>
                  <ChevronUp className={`w-4 h-4 transition-transform ${moreServicesOpen ? '' : 'rotate-180'}`}/> Mais
                </button>
                <AnimatePresence>
                  {moreServicesOpen && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }} 
                      animate={{ opacity: 1, y: 0 }} 
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute bottom-full mb-2 w-full bg-slate-800/90 backdrop-blur-lg border border-white/10 rounded-lg shadow-2xl p-2"
                    >
                      <Link to="/services/library" className={footerLink}><Library className="w-4 h-4"/> Biblioteca</Link>
                      <Link to="/services/digital-archive" className={footerLink}><Bot className="w-4 h-4"/> Acervo Digital</Link>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
          
          <div>
            <span className="text-white font-semibold mb-4 block">Ajuda</span>
             <div className="space-y-3">
                <Link to="/contact" className={footerLink}>
                    <LifeBuoy className="w-4 h-4"/> Suporte
                </Link>
                <Link to="/support-us" className={footerLink}>
                    <Heart className="w-4 h-4"/> Apoie o Projeto
                </Link>
                 <Link to="/faq" className={footerLink}>
                    <HelpCircle className="w-4 h-4"/> FAQ
                </Link>
            </div>
          </div>

        </div>

        <div className="border-t border-white/10 mt-12 pt-8">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <p className="text-gray-400 text-sm mb-4 md:mb-0">
              © {currentYear} GOV.RP. Todos os direitos reservados.
            </p>
            <div className="flex items-center space-x-6 text-sm">
              <Link to="/terms" className="text-gray-300 hover:text-blue-400">Termos de Uso</Link>
              <Link to="/privacy" className="text-gray-300 hover:text-blue-400">Política de Privacidade</Link>
            </div>
          </div>
          <div className="flex items-center justify-center mt-6">
            <p className="text-gray-500 text-sm flex items-center">
              Feito com <Heart className="w-4 h-4 mx-1.5 text-red-500/80" /> para a comunidade de RP
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;