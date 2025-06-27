import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, ChevronDown, Settings, LayoutDashboard, Landmark, Briefcase, FileText, Library, Archive, MessageSquare, Users, Newspaper, Home as HomeIcon, Heart, HelpCircle, LifeBuoy, Grid, Mail, BookOpen, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { useToast } from './ui/use-toast';
import NotificationBell from './NotificationBell';

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  
  const { user, logout, session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();

  const servicesTimeoutRef = useRef(null);
  const userMenuTimeoutRef = useRef(null);
  const navRef = useRef(null);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handleScroll);
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (navRef.current && !navRef.current.contains(event.target)) {
        setServicesOpen(false);
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [navRef]);

  useEffect(() => {
    if (isOpen) {
      document.documentElement.classList.add('menu-open');
    } else {
      document.documentElement.classList.remove('menu-open');
    }
    return () => document.documentElement.classList.remove('menu-open');
  }, [isOpen]);

  useEffect(() => {
    setIsOpen(false);
    setServicesOpen(false);
    setUserMenuOpen(false);
  }, [location]);

  const services = [
    { name: 'Banco Nacional', path: '/services/bank', icon: <Landmark className="w-5 h-5 text-green-400"/> },
    { name: 'Negócios Livres', path: '/services/business', icon: <Briefcase className="w-5 h-5 text-blue-400"/> },
    { name: 'DIC', path: '/services/dic', icon: <FileText className="w-5 h-5 text-purple-400"/> },
    { name: 'X', path: '/services/x', icon: <MessageSquare className="w-5 h-5 text-sky-400"/> },
    { name: 'Biblioteca Nacional', path: '/services/library', icon: <Library className="w-5 h-5 text-orange-400"/> },
    { name: 'Acervo Digital', path: '/services/digital-archive', icon: <Archive className="w-5 h-5 text-rose-400"/> }
  ];

  const navLinks = [
      { name: 'Início', path: '/', icon: HomeIcon },
      { name: 'Serviços', path: '/services', icon: LayoutDashboard, isDropdown: true },
      { name: 'Notícias', path: '/news', icon: Newspaper },
      { name: 'Comunidade', path: '/community', icon: Users },
      { name: 'Suporte', path: '/support', icon: LifeBuoy },
      { name: 'Sobre Nós', path: '/about', icon: BookOpen },
  ];
  
  const handleLogout = async () => {
    await logout();
    toast({ title: 'Você saiu da sua conta.' });
    navigate('/');
  };
  
  const handleServicesEnter = () => { clearTimeout(servicesTimeoutRef.current); setServicesOpen(true); };
  const handleServicesLeave = () => { servicesTimeoutRef.current = setTimeout(() => setServicesOpen(false), 200); };
  const handleServicesClick = (e) => { e.preventDefault(); setServicesOpen(prev => !prev); };
  const handleUserMenuEnter = () => { clearTimeout(userMenuTimeoutRef.current); setUserMenuOpen(true); };
  const handleUserMenuLeave = () => { userMenuTimeoutRef.current = setTimeout(() => setUserMenuOpen(false), 200); };

  const NavLink = ({ to, children, className, icon: Icon }) => (
    <Link to={to} className={`flex items-center gap-2 relative text-white hover:text-blue-300 transition-colors duration-300 font-medium ${className}`}>
      {Icon && <Icon className="w-4 h-4"/>}
      {children}
      {location.pathname === to && (
        <motion.div className="absolute -bottom-2 left-0 right-0 h-0.5 bg-blue-400" layoutId="underline" initial={false} transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
      )}
    </Link>
  );

  return (
    <>
      <motion.nav ref={navRef} initial={{ y: -100 }} animate={{ y: 0 }} transition={{ duration: 0.5, ease: 'easeOut' }} className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${isScrolled || isOpen ? 'bg-slate-900/80 backdrop-blur-xl border-b border-white/10' : 'bg-transparent'}`}>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <Link to="/" className="flex items-center space-x-2"><motion.div whileHover={{ scale: 1.1, rotate: -5 }} className="text-3xl font-bold text-white">GOV.RP</motion.div></Link>

            <div className="hidden md:flex items-center space-x-6">
              {navLinks.map(link => (
                link.isDropdown ? (
                  <div key={link.name} className="relative" onMouseEnter={handleServicesEnter} onMouseLeave={handleServicesLeave}>
                    <button onClick={handleServicesClick} className="flex items-center gap-2 text-white hover:text-blue-300 transition-colors cursor-pointer font-medium"><LayoutDashboard className="w-4 h-4" /><span>{link.name}</span><ChevronDown className={`w-4 h-4 transition-transform ${servicesOpen ? 'rotate-180' : ''}`} /></button>
                    <AnimatePresence>
                      {servicesOpen && (
                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute top-full left-1/2 -translate-x-1/2 mt-4 w-72 bg-slate-800/90 backdrop-blur-lg border border-white/10 rounded-lg shadow-2xl p-2">
                          {services.map((s) => (<Link key={s.path} to={s.path} className="flex items-center space-x-3 px-4 py-3 hover:bg-white/10 transition-colors rounded-md text-white"><div className="flex-shrink-0">{s.icon}</div><span>{s.name}</span></Link>))}
                          <div className="border-t border-white/10 my-1"></div>
                          <Link to="/services" className="flex items-center justify-center space-x-3 px-4 py-3 hover:bg-white/10 transition-colors rounded-md text-blue-300 font-semibold"><Grid className="w-5 h-5"/><span>Ver Todos</span></Link>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ) : (
                  <NavLink key={link.path} to={link.path} icon={link.icon}>{link.name}</NavLink>
                )
              ))}
            </div>

            <div className="hidden md:flex items-center space-x-4">
              {user && <Link to="/support-us"><Button variant="outline" className="border-purple-400/50 text-purple-300 hover:bg-purple-400/10 hover:text-purple-300"><Heart className="w-4 h-4 mr-2"/>Apoiar</Button></Link>}
              {session ? (
                <>
                  <NotificationBell />
                  <div className="relative" onMouseEnter={handleUserMenuEnter} onMouseLeave={handleUserMenuLeave}>
                    <button onClick={() => setUserMenuOpen(p => !p)} className="flex items-center space-x-2 text-white hover:text-blue-300 transition-colors">
                      <img src={user?.avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${user?.username}`} alt="User avatar" className="w-8 h-8 rounded-full object-cover bg-white/10" />
                      <ChevronDown className={`w-4 h-4 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
                    </button>
                    <AnimatePresence>
                      {userMenuOpen && (
                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute top-full right-0 mt-4 w-56 bg-slate-800/90 backdrop-blur-lg border border-white/10 rounded-lg shadow-2xl py-2">
                          <div className="px-4 py-2 border-b border-white/10"><p className="text-sm text-gray-400">Logado como</p><p className="text-white font-semibold truncate">{user?.full_name}</p></div>
                          <Link to="/dashboard" className="flex items-center space-x-3 w-full px-4 py-3 hover:bg-white/10 transition-colors text-white"><LayoutDashboard className="w-5 h-5 text-blue-400" /><span>Dashboard</span></Link>
                          <Link to="/settings" className="flex items-center space-x-3 w-full px-4 py-3 hover:bg-white/10 transition-colors text-white"><Settings className="w-5 h-5 text-gray-400" /><span>Configurações</span></Link>
                          <button onClick={handleLogout} className="flex items-center space-x-3 w-full px-4 py-3 hover:bg-white/10 transition-colors text-red-400"><LogOut className="w-5 h-5" /><span>Sair</span></button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </>
              ) : (
                <>
                  <Link to="/support-us"><Button variant="outline" className="border-purple-400/50 text-purple-300 hover:bg-purple-400/10 hover:text-purple-300"><Heart className="w-4 h-4 mr-2"/>Apoiar</Button></Link>
                  <Link to="/login"><Button variant="ghost" className="text-white hover:bg-white/10 hover:text-white">Entrar</Button></Link>
                  <Link to="/register"><Button className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">Cadastrar</Button></Link>
                </>
              )}
            </div>
            
            <button onClick={() => setIsOpen(!isOpen)} className="md:hidden text-white hover:text-blue-400 transition-colors z-[101] relative">{isOpen ? <X className="w-7 h-7" /> : <Menu className="w-7 h-7" />}</button>
          </div>
        </div>
      </motion.nav>
      <MobileMenu isOpen={isOpen} setIsOpen={setIsOpen} />
    </>
  );
};

const MobileMenu = ({ isOpen, setIsOpen }) => {
  const { user, logout, session } = useAuth();
  const [mobileServicesOpen, setMobileServicesOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = async () => {
    setIsOpen(false);
    await logout();
    navigate('/');
  };

  const services = [
    { name: 'Banco Nacional', path: '/services/bank', icon: <Landmark className="w-5 h-5 text-green-400"/> },
    { name: 'Negócios Livres', path: '/services/business', icon: <Briefcase className="w-5 h-5 text-blue-400"/> },
    { name: 'DIC', path: '/services/dic', icon: <FileText className="w-5 h-5 text-purple-400"/> },
    { name: 'X', path: '/services/x', icon: <MessageSquare className="w-5 h-5 text-sky-400"/> },
    { name: 'Biblioteca Nacional', path: '/services/library', icon: <Library className="w-5 h-5 text-orange-400"/> },
    { name: 'Acervo Digital', path: '/services/digital-archive', icon: <Archive className="w-5 h-5 text-rose-400"/> }
  ];

  const mainLinks = [
    { name: 'Início', path: '/', icon: HomeIcon },
    { name: 'Notícias', path: '/news', icon: Newspaper },
    { name: 'Comunidade', path: '/community', icon: Users },
    { name: 'Sobre Nós', path: '/about', icon: BookOpen },
    { name: 'Apoie o Projeto', path: '/support-us', icon: Heart },
  ];
  const supportLinks = [
    { name: 'Suporte', path: '/support', icon: LifeBuoy },
    { name: 'Contato', path: '/contact', icon: Mail },
    { name: 'Documentação', path: '/docs', icon: BookOpen },
    { name: 'FAQ', path: '/faq', icon: HelpCircle },
  ];
  
  const NavLink = ({ to, children, icon: Icon, onClick }) => (
    <Link to={to} onClick={onClick} className="text-xl p-4 rounded-lg hover:bg-white/5 flex items-center w-full text-white gap-4">
      <Icon className="w-6 h-6"/>
      {children}
    </Link>
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="md:hidden fixed inset-0 z-[100] bg-slate-900/80 backdrop-blur-lg"
          onClick={() => setIsOpen(false)}
        >
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="absolute top-0 right-0 h-full w-full max-w-sm bg-slate-900 shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-end p-4">
               <button onClick={() => setIsOpen(false)} className="text-white hover:text-blue-400 transition-colors p-2">
                 <X className="w-7 h-7" />
               </button>
            </div>
            <div className="flex-grow px-6 pb-6 overflow-y-auto custom-scrollbar">
              <nav className="flex flex-col gap-1">
                {mainLinks.map(link => (
                  <NavLink key={link.path} to={link.path} icon={link.icon} onClick={() => setIsOpen(false)}>
                    {link.name}
                  </NavLink>
                ))}

                <div>
                  <button onClick={() => setMobileServicesOpen(p => !p)} className="text-xl p-4 rounded-lg hover:bg-white/5 flex items-center justify-between w-full text-white gap-4">
                    <div className="flex items-center gap-4"><LayoutDashboard className="w-6 h-6"/>Serviços</div>
                    <ChevronDown className={`w-5 h-5 transition-transform ${mobileServicesOpen ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {mobileServicesOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden pl-8">
                        <div className="pt-2 pb-2 space-y-1 border-l-2 border-white/10">
                          {services.map(s => <Link key={s.path} to={s.path} onClick={() => setIsOpen(false)} className="text-lg p-3 rounded-md hover:bg-white/5 flex items-center w-full text-white gap-3"><div className="flex-shrink-0">{s.icon}</div>{s.name}</Link>)}
                          <div className="border-t border-white/10 my-2 mx-3"></div>
                          <Link to="/services" onClick={() => setIsOpen(false)} className="text-lg p-3 rounded-md hover:bg-white/5 flex items-center w-full font-semibold text-blue-300 gap-3"><Grid className="w-5 h-5"/>Ver Todos</Link>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </nav>

              <div className="mt-6 pt-6 border-t border-white/10">
                <span className="px-4 text-sm font-semibold text-gray-400 uppercase">Ajuda & Informações</span>
                <div className="mt-2 space-y-1">
                  {supportLinks.map(link => (
                      <NavLink key={link.path} to={link.path} icon={link.icon} onClick={() => setIsOpen(false)}>
                        {link.name}
                      </NavLink>
                  ))}
                </div>
              </div>
            </div>
            
            <div className="flex-shrink-0 p-6 border-t border-white/10">
              {session ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                     <img src={user?.avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${user?.username}`} alt="User avatar" className="w-12 h-12 rounded-full object-cover bg-white/10" />
                     <div>
                       <p className="font-semibold text-white truncate">{user?.full_name}</p>
                       <p className="text-sm text-gray-400">@{user?.username}</p>
                     </div>
                  </div>
                  <Link to="/dashboard" onClick={() => setIsOpen(false)} className="w-full"><Button variant="outline" className="w-full border-white/20 text-white justify-start gap-4"><LayoutDashboard/>Dashboard</Button></Link>
                  <Button variant="destructive" onClick={handleLogout} className="w-full justify-start gap-4 bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/40 hover:text-red-300"><LogOut/>Sair</Button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <Link to="/login" className="w-full"><Button variant="outline" size="lg" className="w-full border-white/20 text-white">Entrar</Button></Link>
                  <Link to="/register" className="w-full"><Button size="lg" className="w-full bg-gradient-to-r from-blue-600 to-purple-600">Cadastrar</Button></Link>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default Navbar;