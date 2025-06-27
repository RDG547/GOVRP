import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Github, Mail, Heart, HelpCircle, LifeBuoy, BookOpen, Newspaper, Landmark, Briefcase, FileText, Users, Scroll, ArrowRight, Home as HomeIcon, Milestone } from 'lucide-react';
import { FaWhatsapp, FaDiscord, FaTelegram } from 'react-icons/fa';

const Footer = () => {
  const currentYear = new Date().getFullYear();

  const footerLink = "flex items-center gap-2 text-gray-300 hover:text-blue-400 transition-colors duration-300";
  const socialLink = "text-gray-400 hover:text-white transition-colors duration-300";

  return (
    <footer className="bg-slate-900/50 backdrop-blur-lg border-t border-white/10 mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-12">
          <div className="col-span-2 md:col-span-3 lg:col-span-1">
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
              <motion.a whileHover={{ scale: 1.2, y: -2 }} href="https://github.com/RDG547/GOVRP" target="_blank" rel="noopener noreferrer" className={socialLink}>
                <Github className="w-5 h-5" />
              </motion.a>
              <motion.a whileHover={{ scale: 1.2, y: -2 }} href="https://chat.whatsapp.com/KKqiDj1HyxM97NK9YAFNnj" target="_blank" rel="noopener noreferrer" className={socialLink}>
                <FaWhatsapp size={22} />
              </motion.a>
              <motion.a whileHover={{ scale: 1.2, y: -2 }} href="https://discord.gg/NwJuuzKbUU" target="_blank" rel="noopener noreferrer" className={socialLink}>
                <FaDiscord size={22} />
              </motion.a>
              <motion.a whileHover={{ scale: 1.2, y: -2 }} href="https://t.me/geopolitical_simulator5" target="_blank" rel="noopener noreferrer" className={socialLink}>
                <FaTelegram size={22} />
              </motion.a>
              <motion.a whileHover={{ scale: 1.2, y: -2 }} href="mailto:suporte@govrp.online" className={socialLink}>
                <Mail className="w-5 h-5" />
              </motion.a>
            </div>
          </div>

          <div>
            <span className="text-white font-semibold mb-4 block">Geral</span>
            <div className="space-y-3">
              <Link to="/" className={footerLink}><HomeIcon className="w-4 h-4"/> Início</Link>
              <Link to="/about" className={footerLink}><BookOpen className="w-4 h-4"/> Sobre Nós</Link>
              <Link to="/community" className={footerLink}><Users className="w-4 h-4"/> Comunidade</Link>
              <Link to="/news" className={footerLink}><Newspaper className="w-4 h-4"/> Notícias</Link>
            </div>
          </div>

          <div>
            <span className="text-white font-semibold mb-4 block">Serviços</span>
            <div className="space-y-3">
              <Link to="/services/bank" className={footerLink}><Landmark className="w-4 h-4"/> Banco</Link>
              <Link to="/services/business" className={footerLink}><Briefcase className="w-4 h-4"/> Negócios</Link>
              <Link to="/services/dic" className={footerLink}><FileText className="w-4 h-4"/> DIC</Link>
              <Link to="/services" className={footerLink}><ArrowRight className="w-4 h-4"/> Ver todos</Link>
            </div>
          </div>
          
          <div>
            <span className="text-white font-semibold mb-4 block">Ajuda</span>
             <div className="space-y-3">
                <Link to="/contact" className={footerLink}>
                    <Mail className="w-4 h-4"/> Contato
                </Link>
                <Link to="/support" className={footerLink}>
                    <LifeBuoy className="w-4 h-4"/> Suporte
                </Link>
                 <Link to="/faq" className={footerLink}>
                    <HelpCircle className="w-4 h-4"/> FAQ
                </Link>
                <Link to="/docs" className={footerLink}><Scroll className="w-4 h-4"/> Docs</Link>
                <Link to="/roadmap" className={footerLink}><Milestone className="w-4 h-4"/> Roadmap</Link>
            </div>
          </div>
          
          <div>
            <span className="text-white font-semibold mb-4 block">Apoio</span>
             <div className="space-y-3">
                <Link to="/support-us" className={footerLink}>
                    <Heart className="w-4 h-4"/> Apoie o Projeto
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